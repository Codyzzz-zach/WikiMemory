# Stage A Leakage Scan

按合同 denylist（Stage B 专用字段名集合，其 sha256 = `ef80cda0463bf036c476ae755e7077979ee8c94090449216febcbb044767d36b`）扫描全部 Stage A 文件。
denylist 是扫描器配置的一部分，不在此报告中展开字段名，以避免把字段名本身写入公开 payload。

Matches found: 0

无任何 Stage A 文件命中 denylist。

扫描范围：corpus/（140 个 Source 快照 md）、manifests/、questions/、episodes/、reports/ 下全部 .md/.jsonl/.json 文件；排除本报告自身与 contract-manifest.json 的 fileInventory 索引（无字段内容）。
公开数据 payload（corpus/manifests/questions/episodes）与扫描器配置（本报告）严格区分；字段名集合仅存在于扫描器配置的 sha256 摘要中。