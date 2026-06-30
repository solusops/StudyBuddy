from fastapi import APIRouter

router = APIRouter(prefix="/review", tags=["review"])

@router.get("/daily")
async def get_daily_review():
    import cognee
    from cognee import SearchType
    try:
        results = await cognee.search(
            query_text="What concepts were mastered more than 7 days ago?", 
            query_type=SearchType.GRAPH_COMPLETION,
            top_k=10
        )
        # Explicitly serialize the graph objects to strings/dicts
        serialized_results = [str(r) for r in results] if isinstance(results, list) else str(results)
        return {"concepts_to_review": serialized_results}
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Failed to get daily review: %s", e)
        return {"error": str(e), "concepts_to_review": []}
