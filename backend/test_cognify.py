import asyncio
import os
os.environ['LLM_API_KEY'] = 'test'
os.environ['LLM_API_BASE'] = 'https://api.cerebras.ai/v1'
os.environ['LLM_MODEL'] = 'openai/gemma-4-31b'

import cognee
from cognee import SearchType

async def main():
    try:
        # Instead of setup, let's just add something and cognify
        await cognee.add("test dataset", "test data")
        await cognee.cognify()
        res = await cognee.search('test', query_type=SearchType.GRAPH_COMPLETION)
        print("Search succeeded:", res)
    except Exception as e:
        print("Error:", type(e), repr(e))

asyncio.run(main())
