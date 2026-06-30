import asyncio
import os
import sys

os.environ['LLM_API_KEY'] = 'test'
os.environ['LLM_API_BASE'] = 'https://api.cerebras.ai/v1'
os.environ['LLM_MODEL'] = 'gemma-4-31b'

import cognee

async def main():
    print('Pruning...')
    await cognee.prune.prune_system(metadata=True)
    print('Setup...')
    await cognee.setup()
    print('Done.')

asyncio.run(main())
