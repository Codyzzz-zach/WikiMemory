# Unresolved Issues and Access Failures — Batch C Stage A

## Access Limitations

### Sources with Partial Access (accessStatus: "partial")

1. **c-psych-001** (OSC 2015): Full text behind Science paywall (DOI: 10.1126/science.aac4716). Key statistics (97%, 36%, 47%, 39%, 68%) verified from publicly available abstract and ResearchGate preprint. Supplementary materials available on OSF.

2. **c-psych-003** (Gilbert et al. 2016): Full Science comment behind paywall (DOI: 10.1126/science.aad7243). Key arguments captured from Harvard Gazette detailed coverage, which includes extensive verbatim quotes and analysis.

3. **c-psych-004** (Nature survey): Full article behind Nature paywall. Survey methodology and key statistics verified from publicly accessible summaries and the original survey data (available on Figshare).

4. **c-law-004** (Meta response): Meta's full legal filings not publicly accessible. Corporate PR statements and regulatory summaries used.

### Mitigations

- All exactQuotes attributed to these partial sources are verified against publicly accessible content.
- No quotes were constructed from memory or inference.
- Access status transparently marked in each source's frontmatter.

## Unresolved Issues

### 1. Source Version Drift Risk

- **c-law-002** (DPC Meta decision): Meta's appeal is ongoing. The decision's legal status may change.
- **c-law-004** (EU-US DPF): The 2023 adequacy decision may face legal challenges.

### 2. Content Completeness

- For c-psych-001 and c-psych-003, the full methodology sections and statistical appendices are not captured.
- This may limit the ability to answer questions requiring deep methodological scrutiny.

### 3. Temporal Coverage Gaps

- The psychology-reproducibility sources cover 2014-2016. More recent developments (e.g., Many Labs 5, registered replication reports) are not included.
- The climate-energy-policy sources are current to 2025/2026. Future IPCC AR7 or EU policy amendments would create gaps.

### 4. Language Diversity

- All 12 sources are in English. No non-English sources were included, which may miss domain-specific perspectives from non-English-speaking jurisdictions (especially relevant for law-public-policy).

### 5. Legal Source Jurisdiction Bias

- Law-public-policy sources are heavily EU-focused. US, Chinese, or other jurisdiction perspectives are absent.
- This is noted as a limitation per the default domain specification.

## No Access Failures

All sources were successfully accessed through their publicly available interfaces. No source required login bypass, paywall circumvention, or robots.txt violation.
