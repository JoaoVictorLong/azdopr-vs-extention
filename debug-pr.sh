#!/usr/bin/env bash
set -euo pipefail

ORG="AASolutions"
PROJECT="us_source"
REPO="WebMag"
PR_ID=281709

echo "=== Insira seu PAT abaixo ==="
read -rs PAT
echo

# 1. Fetch PR directly by ID
echo "=== 1. Fetching PR #$PR_ID directly ==="
curl -s -u ":$PAT" \
  "https://dev.azure.com/$ORG/$PROJECT/_apis/git/repositories/$REPO/pullRequests/$PR_ID?api-version=7.0" \
  | python3 -m json.tool | head -60

echo
echo "=== 2. Checking org-level list for this PR ==="
curl -s -u ":$PAT" \
  "https://dev.azure.com/$ORG/_apis/git/pullRequests?searchCriteria.status=active&\$top=200&api-version=7.0" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
prs = data.get('value', [])
print(f'Total active PRs returned: {len(prs)}')
found = [p for p in prs if p.get('pullRequestId') == $PR_ID]
if found:
    pr = found[0]
    print(f'Found! Status={pr.get(\"status\")}, IsDraft={pr.get(\"isDraft\")}, SourceBranch={pr.get(\"sourceRefName\")}')
else:
    print('PR #$PR_ID NOT FOUND in org-level list')
    # Check if any PR has this ID with different status
    for p in prs[:3]:
        print(f'  Sample PR: id={p.get(\"pullRequestId\")} status={p.get(\"status\")} repo={p.get(\"repository\",{}).get(\"name\")} proj={p.get(\"repository\",{}).get(\"project\",{}).get(\"name\")}')
"
