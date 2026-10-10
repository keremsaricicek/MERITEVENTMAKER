Baseline `65808d5`: **43 / 75** rows met. Final: **77 / 82**.

| plan | row | target | before | after | |
|---|---|---|---|---|---|
| merit-real-venue | `table.precision` | >= 0.97 | 0.979 ✓ | 1 ✓ |  |
| merit-real-venue | `table.recall` | >= 0.97 | 1 ✓ | 1 ✓ |  |
| merit-real-venue | `table.countError` | <= 0.03 | 0.022 ✓ | 0 ✓ |  |
| merit-real-venue | `bistro.precision` | >= 0.9 | 1 ✓ | 1 ✓ |  |
| merit-real-venue | `bistro.recall` | >= 0.9 | 1 ✓ | 1 ✓ |  |
| merit-real-venue | `chair.precision` | >= 0.95 | 1 ✓ | 0.991 ✓ |  |
| merit-real-venue | `chair.recall` | >= 0.95 | 0.947 ✗ | 0.956 ✓ | FIXED |
| merit-real-venue | `chair.countError` | <= 0.05 | 0.053 ✗ | 0.035 ✓ | FIXED |
| merit-real-venue | `sofa.precision` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `sofa.recall` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `sofa.shapeIoUMedian` | >= 0.5 | not measured | 0.881 ✓ | NEW ROW |
| merit-real-venue | `stage.precision` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `stage.recall` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `stage.shapeIoUMedian` | >= 0.5 | not measured | 0.613 ✓ | NEW ROW |
| merit-real-venue | `column.precision` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `column.recall` | >= 0.9 | 0 ✗ | 0.9 ✓ | FIXED |
| merit-real-venue | `column.shapeIoUMedian` | >= 0.5 | not measured | 0.802 ✓ | NEW ROW |
| merit-real-venue | `bar.precision` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `bar.recall` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `bar.shapeIoUMedian` | >= 0.5 | not measured | 0.046 ✗ | NEW ROW |
| merit-real-venue | `entrance.precision` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `entrance.recall` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `entrance.shapeIoUMedian` | >= 0.5 | not measured | 0.225 ✗ | NEW ROW |
| merit-real-venue | `loca.absentFalsePositives` | <= 0 | 0 ✓ | 0 ✓ |  |
| merit-real-venue | `links.accuracy` | >= 0.97 | 0.99 ✓ | 0.99 ✓ |  |
| merit-real-venue | `links.endToEnd` | >= 0.92 | 0.917 ✗ | 0.945 ✓ | FIXED |
| merit-real-venue | `groups.accuracy` | >= 0.9 | 1 ✓ | 1 ✓ |  |
| merit-real-venue | `groups.chairCountExactShare` | >= 0.9 | 1 ✓ | 1 ✓ |  |
| merit-real-venue | `groups.spurious` | <= 1 | 1 ✓ | 1 ✓ |  |
| merit-real-venue | `geometry.tableCentreErrorP90Share` | <= 0.15 | 0.035 ✓ | 0.035 ✓ |  |
| merit-real-venue | `geometry.tableIoUP10` | >= 0.6 | 0.914 ✓ | 0.914 ✓ |  |
| merit-real-venue | `geometry.tableTypeAccuracy` | >= 0.97 | 1 ✓ | 1 ✓ |  |
| merit-real-venue | `geometry.tableRotationErrorP90Deg` | <= 5 | 0 ✓ | 0 ✓ |  |
| merit-real-venue | `geometry.chairCentreErrorP90Share` | <= 0.35 | 0.071 ✓ | 0.071 ✓ |  |
| merit-real-venue | `direction.precision` | >= 0.95 | 0.684 ✗ | 1 ✓ | FIXED |
| merit-real-venue | `direction.coverage` | >= 0.8 | 0.115 ✗ | 0.699 ✗ |  |
| merit-real-venue | `printed.capacityTotalCorrect` | == True | False ✗ | True ✓ | FIXED |
| merit-real-venue | `capacity.heldBackLeak` | <= 0 | 5 ✗ | 0 ✓ | FIXED |
| merit-real-venue | `capacity.drawnChairsError` | <= 0.05 | 0.009 ✓ | 0.035 ✓ |  |
| merit-real-venue | `capacity.writtenTotalCorrect` | == True | False ✗ | True ✓ | FIXED |
| merit-real-venue | `digital.committedEqualsOffered` | == True | True ✓ | True ✓ |  |
| merit-real-venue | `digital.tableCentreErrorP90Share` | <= 0.15 | 0.299 ✗ | 0.035 ✓ | FIXED |
| merit-real-venue | `digital.tableAspectLogErrorP90` | <= 0.1 | 0.267 ✗ | 0.046 ✓ | FIXED |
| merit-real-venue | `digital.tableSizeErrorP90` | <= 0.15 | 0.447 ✗ | 0.053 ✓ | FIXED |
| merit-real-venue | `digital.chairCentreErrorP90Share` | <= 0.35 | 0.703 ✗ | 0.1 ✓ | FIXED |
| merit-real-venue | `corrections.perHundredObjects` | <= 5 | 14.205 ✗ | 4.545 ✓ | FIXED |
| merit-real-venue | `run.analysisMs` | <= 15000 | 7741 ✓ | 10997 ✓ |  |
| merit-real-venue | `run.peakHeapMB` | <= 1024 | 18.8 ✓ | 37.5 ✓ |  |
| merit-real-venue | `run.planDataEgress` | <= 0 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `table.precision` | >= 0.97 | 0.994 ✓ | 0.994 ✓ |  |
| ornek-symbolic | `table.recall` | >= 0.97 | 0.976 ✓ | 0.976 ✓ |  |
| ornek-symbolic | `table.countError` | <= 0.03 | 0.018 ✓ | 0.018 ✓ |  |
| ornek-symbolic | `bistro.absentFalsePositives` | <= 0 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `chair.absentFalsePositives` | <= 0 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `sofa.absentFalsePositives` | <= 0 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `stage.absentFalsePositives` | <= 0 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `column.precision` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| ornek-symbolic | `column.recall` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| ornek-symbolic | `column.shapeIoUMedian` | >= 0.5 | not measured | 0.87 ✓ | NEW ROW |
| ornek-symbolic | `bar.absentFalsePositives` | <= 0 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `entrance.absentFalsePositives` | <= 0 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `loca.precision` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| ornek-symbolic | `loca.recall` | >= 0.9 | 0 ✗ | 1 ✓ | FIXED |
| ornek-symbolic | `loca.shapeIoUMedian` | >= 0.5 | not measured | 0.934 ✓ | NEW ROW |
| ornek-symbolic | `groups.spurious` | <= 1 | 1 ✓ | 0 ✓ |  |
| ornek-symbolic | `geometry.tableCentreErrorP90Share` | <= 0.15 | 0.095 ✓ | 0.095 ✓ |  |
| ornek-symbolic | `geometry.tableIoUP10` | >= 0.6 | 0.703 ✓ | 0.719 ✓ |  |
| ornek-symbolic | `geometry.tableTypeAccuracy` | >= 0.97 | 1 ✓ | 1 ✓ |  |
| ornek-symbolic | `geometry.tableRotationErrorP90Deg` | <= 5 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `printed.tableNumberRecall` | >= 0.9 | 0.554 ✗ | 0.924 ✓ | FIXED |
| ornek-symbolic | `printed.tableNumberVerifiedPrecision` | >= 0.99 | 1 ✓ | 1 ✓ |  |
| ornek-symbolic | `printed.capacityTotalCorrect` | == True | True ✓ | True ✓ |  |
| ornek-symbolic | `capacity.heldBackLeak` | <= 0 | 0 ✓ | 0 ✓ |  |
| ornek-symbolic | `capacity.writtenTotalCorrect` | == True | True ✓ | True ✓ |  |
| ornek-symbolic | `digital.committedEqualsOffered` | == True | True ✓ | True ✓ |  |
| ornek-symbolic | `digital.tableCentreErrorP90Share` | <= 0.15 | 0.528 ✗ | 0.097 ✓ | FIXED |
| ornek-symbolic | `digital.tableAspectLogErrorP90` | <= 0.1 | 0.201 ✗ | 0.107 ✗ |  |
| ornek-symbolic | `digital.tableSizeErrorP90` | <= 0.15 | 0.25 ✗ | 0.145 ✓ | FIXED |
| ornek-symbolic | `corrections.perHundredObjects` | <= 5 | 11.538 ✗ | 2.747 ✓ | FIXED |
| ornek-symbolic | `run.analysisMs` | <= 60000 | 32403 ✓ | 66447 ✗ | LOST |
| ornek-symbolic | `run.peakHeapMB` | <= 1024 | 52.3 ✓ | 61.9 ✓ |  |
| ornek-symbolic | `run.planDataEgress` | <= 0 | 0 ✓ | 0 ✓ |  |
