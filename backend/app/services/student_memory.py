"""Cross-session student memory backed by Cognee + LanceDB.

Write path: push_session() → cognee.remember() with session_id (cache) →
            cognee.improve() at END_SESSION (flush to graph, fire-and-forget).
Read path:  query_prior_knowledge() → cognee.search(CHUNKS) -> pure vector
            search, no LLM call, returns raw text for BrainAgent context.
"""
from typing import List

from app.schemas.graph import NodePatch
from app.schemas.journal import JournalEntry


class StudentMemoryService:
    async def push_session(
        self,
        session_id: str,
        topic: str,
        journal: List[JournalEntry],
        patches: List[NodePatch],
        session_summary: str = "",
    ) -> None:
        import cognee
        try:
            # Derive per-node signals from journal
            quiz_totals: dict = {}
            quiz_correct: dict = {}
            fc_grades: dict = {}
            feynman_nodes: set = set()

            for entry in journal:
                nid = entry.node_id
                if entry.event_type.value == "quiz_submit":
                    quiz_totals[nid] = quiz_totals.get(nid, 0) + 1
                    if entry.data.get("was_correct"):
                        quiz_correct[nid] = quiz_correct.get(nid, 0) + 1
                elif entry.event_type.value == "flashcard_grade":
                    grade = entry.data.get("grade", 0)
                    if nid not in fc_grades:
                        fc_grades[nid] = {"good": 0, "total": 0}
                    fc_grades[nid]["total"] += 1
                    if grade in (3, 4):  # Good or Easy
                        fc_grades[nid]["good"] += 1
                elif entry.event_type.value == "feynman_turn":
                    if entry.data.get("event") == "turn":
                        feynman_nodes.add(nid)

            # Build summary text per patch
            lines = [f"Study session on topic: {topic}"]
            weak: list = []
            for patch in patches:
                nid = patch.node_id
                sp = patch.score_patch or {}
                classification = _infer_classification(sp)

                quiz_acc = -1.0
                if nid in quiz_totals and quiz_totals[nid] > 0:
                    quiz_acc = quiz_correct.get(nid, 0) / quiz_totals[nid]

                fc_ease = -1.0
                if nid in fc_grades and fc_grades[nid]["total"] > 0:
                    fc_ease = fc_grades[nid]["good"] / fc_grades[nid]["total"]

                feynman = nid in feynman_nodes
                label = nid  # node_id used as label; handlers pass node_label separately

                line = (
                    f"Node '{label}' classification: {classification}. "
                    f"Scores: memory {sp.get('memory', 0)}, "
                    f"comprehension {sp.get('comprehension', 0)}, "
                    f"structure {sp.get('structure', 0)}, "
                    f"application {sp.get('application', 0)}."
                )
                if quiz_acc >= 0:
                    line += f" Quiz accuracy: {quiz_acc:.0%}."
                if fc_ease >= 0:
                    line += f" Flashcard ease: {fc_ease:.0%}."
                if feynman:
                    line += " Student attempted Feynman explanation."
                lines.append(line)

                if classification in ("building_basics", "foundational"):
                    weak.append(label)

            if weak:
                lines.append(f"Weak areas needing review: {', '.join(weak)}.")

            if session_summary:
                lines.append(f"Session Summary:\n{session_summary}")

            summary = "\n".join(lines)

            # Cache to Cognee session (no graph build yet)
            await cognee.add(
                summary,
                dataset_name="student_memory"
            )
            # Flush session cache to permanent graph
            await cognee.cognify(datasets=["student_memory"])
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error("push_session failed: %s", exc)

    async def query_prior_knowledge(self, topic: str) -> str:
        import cognee
        from cognee import SearchType
        try:
            results = await cognee.search(
                query_text=f"student name personal details struggles weaknesses mastery {topic}",
                query_type=SearchType.CHUNKS,
                datasets=["student_memory"],
                top_k=8,
            )
            if not results:
                return ""
            chunks = [str(r) for r in results if r]
            if not chunks:
                return ""
            return f'Prior learning context for "{topic}":\n' + "\n".join(chunks[:5])
        except Exception as exc:
            msg = str(exc)
            if "No data found in the system" in msg or "DatabaseNotCreatedError" in msg:
                # Expected on fresh installs before any END_SESSION event has occurred
                return ""
            import logging
            logging.getLogger(__name__).warning("query_prior_knowledge failed: %s", exc)
            return ""


def _infer_classification(score_patch: dict) -> str:
    avg = sum(score_patch.values()) / len(score_patch) if score_patch else 0
    if avg >= 88:
        return "sophisticated"
    if avg >= 70:
        return "comfortable"
    if avg >= 40:
        return "foundational"
    return "building_basics"
