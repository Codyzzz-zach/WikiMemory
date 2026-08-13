# Overlap / Denylist Report

## 4-layer denylist built from 3 historical manifests (38 sources)

- Layer 1 (normalized canonical URLs): 38
- Layer 2 (snapshot hashes): 38; artifact hashes: 26
- Layer 3 (repo/commit/tag, DOI, CELEX, regulation ids): 12
- Layer 4 (event clusters): 9 (all 38 historical sources assigned)

## New-source overlap checks

Checked 140 new sources against all 4 layers (URL normalization, hash comparison, repo/DOI/CELEX keys, cluster-name collision).
Sources flagged: 0


All remaining sources: verdict `new-cluster` (see source-manifest.jsonl `historicalOverlapVerdict`).

Note: historical event clusters and their members are listed in the denylist; domain overlap is permitted, cluster overlap is not.