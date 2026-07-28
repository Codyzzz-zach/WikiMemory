# Overlap Check — Batch C vs Batch A/B

## Domain Isolation Verification

### Batch C Default Domains (new)
1. psychology-reproducibility
2. climate-energy-policy
3. law-public-policy

### Batch A/B Known Domains (excluded from Batch C)
Per contract Section 3, the following domains are excluded:
- AI / technology
- Finance
- Mathematics
- Health communication
- Ancient texts studies (古卷研究)
- WCAG / accessibility

## Source-Level Overlap Check

| Batch C Source | URL Domain | Overlap with Batch A/B? |
|---------------|-----------|------------------------|
| c-psych-001 | science.org | No — not in any AI/tech/finance/math/health/WCAG source cluster |
| c-psych-002 | metajnl.com / osf.io | No — OSF is a general repository, but this project is psychology-only |
| c-psych-003 | science.org / harvard.edu | No |
| c-psych-004 | nature.com | No — Nature survey covers general science, not domain-specific |
| c-climate-001 | ipcc.ch | No |
| c-climate-002 | eur-lex.europa.eu | No |
| c-climate-003 | carbonbrief.org | No |
| c-climate-004 | iea.org | No |
| c-law-001 | eur-lex.europa.eu | No |
| c-law-002 | edpb.europa.eu / regsol.ie | No |
| c-law-003 | gdprhub.eu | No |
| c-law-004 | about.fb.com | No |

## GitHub Repository / Standard Version Chain Check

No Batch C sources reference GitHub repositories, standard version chains, or code repositories that appear in Batch A/B canonical URLs.

## Event Cluster Isolation

Batch C does not reference any of the same real-world events, policy developments, or research findings as Batch A/B.

## Conclusion

All 12 source snapshots and 3 domain clusters are confirmed isolated from Batch A/B. No overlapping URLs, repositories, standards, or event clusters detected.
