import asyncio
import os
os.environ['LLM_API_KEY'] = 'test'
os.environ['LLM_API_BASE'] = 'https://api.cerebras.ai/v1'
os.environ['LLM_MODEL'] = 'gemma-4-31b'

import cognee
from cognee import SearchType

async def main():
    try:
        await cognee.search('hello', query_type=SearchType.GRAPH_COMPLETION)
    except Exception as e:
        print(repr(e))
        print(getattr(e, 'message', str(e)))

asyncio.run(main())
