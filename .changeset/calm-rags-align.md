---
'@opensaas/stack-rag': patch
---

`batchProcess` keeps `embeddings` aligned to `texts` (`null` where a batch failed), and `simpleChunkText` throws when `overlap >= chunkSize` instead of looping forever.
