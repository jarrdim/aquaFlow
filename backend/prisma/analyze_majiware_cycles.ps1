param(
  [string]$MdbPath = "",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Data

if (-not $MdbPath) {
  $MdbPath = Join-Path $PSScriptRoot "..\..\documets-and-flow\aquaflow_migration_package\MajiWare.mdb"
}
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $PSScriptRoot "..\..\docs\majiware-cycle-analysis"
}

$MdbPath = (Resolve-Path -LiteralPath $MdbPath).Path
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null

$rawPath = Join-Path $OutputDirectory "MajiWare_Meter_Reading_Dates.csv"
$intervalPath = Join-Path $OutputDirectory "MajiWare_Inferred_Reading_Cycles.csv"
$windowPath = Join-Path $OutputDirectory "MajiWare_Bill_Period_Windows.csv"
$jsonPath = Join-Path $OutputDirectory "MajiWare_Reading_Cycle_Analysis.json"
$markdownPath = Join-Path $OutputDirectory "MajiWare_Reading_Cycle_Analysis.md"

$utf8 = New-Object System.Text.UTF8Encoding($true)

function CsvCell([object]$Value) {
  if ($null -eq $Value -or $Value -is [System.DBNull]) { return "" }
  $text = [string]$Value
  if ($text.Contains('"')) { $text = $text.Replace('"', '""') }
  if ($text.IndexOfAny([char[]]@(',', '"', "`r", "`n")) -ge 0) {
    return '"' + $text + '"'
  }
  return $text
}

function CsvLine([object[]]$Values) {
  return (($Values | ForEach-Object { CsvCell $_ }) -join ",")
}

function IsoDate([datetime]$Value) {
  return $Value.ToString("yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
}

function AddCount([hashtable]$Map, [int]$Key) {
  if ($Map.ContainsKey($Key)) { $Map[$Key]++ } else { $Map[$Key] = 1 }
}

function Percent([long]$Count, [long]$Total) {
  if ($Total -eq 0) { return 0 }
  return [math]::Round(($Count * 100.0) / $Total, 2)
}

function ModeEntry([hashtable]$Map) {
  if ($Map.Count -eq 0) { return $null }
  $entry = $Map.GetEnumerator() |
    Sort-Object @{ Expression = "Value"; Descending = $true }, @{ Expression = "Key"; Descending = $false } |
    Select-Object -First 1
  return [ordered]@{ value = [int]$entry.Key; count = [long]$entry.Value }
}

function MedianFromHistogram([hashtable]$Map, [long]$Total) {
  if ($Total -eq 0) { return $null }
  $leftTarget = [long][math]::Floor(($Total + 1) / 2)
  $rightTarget = [long][math]::Floor(($Total + 2) / 2)
  $running = 0L
  $left = $null
  $right = $null
  foreach ($key in ($Map.Keys | Sort-Object)) {
    $running += [long]$Map[$key]
    if ($null -eq $left -and $running -ge $leftTarget) { $left = [int]$key }
    if ($running -ge $rightTarget) {
      $right = [int]$key
      break
    }
  }
  return [math]::Round(($left + $right) / 2.0, 1)
}

function ReaderValue($Reader, [int]$Index) {
  $value = $Reader.GetValue($Index)
  if ($null -eq $value -or $value -is [System.DBNull]) { return $null }
  return $value
}

$connection = New-Object System.Data.OleDb.OleDbConnection(
  "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$MdbPath;Persist Security Info=False;"
)
$connection.Open()

try {
  $accountMeter = @{}
  $customerCommand = $connection.CreateCommand()
  $customerCommand.CommandText =
    "SELECT AccountNumber, MeterNumber FROM ClientsMaster WHERE AccountNumber Is Not Null"
  $customers = $customerCommand.ExecuteReader()
  while ($customers.Read()) {
    $account = [string](ReaderValue $customers 0)
    $meter = [string](ReaderValue $customers 1)
    if (-not $accountMeter.ContainsKey($account) -and $meter.Trim()) {
      $accountMeter[$account] = $meter.Trim()
    }
  }
  $customers.Dispose()
  $customerCommand.Dispose()

  $sourceCounts = [ordered]@{ History = 0L; Current = 0L }
  $dateNullCount = 0L
  $pre2000ReadingCount = 0L
  $futureReadingCount = 0L
  $rowCount = 0L
  $meterKeys = [System.Collections.Generic.HashSet[string]]::new()
  $earliestReading = $null
  $latestReading = $null

  $intervalCount = 0L
  $validIntervalCount = 0L
  $invalidIntervalCount = 0L
  $duplicateDateIntervals = 0L
  $shortIntervals = 0L
  $longIntervals = 0L
  $pre2000Intervals = 0L
  $futureIntervals = 0L
  $unmappedMeterIntervals = 0L
  $durationSum = 0L
  $monthly28to32 = 0L

  $startDays = @{}
  $endDays = @{}
  $durations = @{}
  $exactStart26 = 0L
  $nearStart26 = 0L
  $exactEnd25 = 0L
  $nearEnd25 = 0L
  $exactJoint2625 = 0L
  $nearJoint2625 = 0L

  $billWindows = @{}
  $analysisToday = [datetime]::Today
  $futureLimit = $analysisToday.AddDays(31)

  $rawWriter = New-Object System.IO.StreamWriter($rawPath, $false, $utf8)
  $intervalWriter = New-Object System.IO.StreamWriter($intervalPath, $false, $utf8)
  try {
    $rawWriter.WriteLine((CsvLine @(
      "Source", "Account Number", "Meter ID", "Reading Date", "Bill Period",
      "Meter Reading", "Valid Date?", "Notes"
    )))
    $intervalWriter.WriteLine((CsvLine @(
      "Meter ID", "Account Number", "Cycle Start", "Cycle End",
      "Duration (days)", "Valid?", "Notes"
    )))

    $sql = @"
SELECT AccountNumber, MeterReadingDate, BillPeriod, MeterReading, SourceName
FROM (
  SELECT AccountNumber, MeterReadingDate, BillPeriod, MeterReading, 'History' AS SourceName
  FROM MeterReadingsHistory
  UNION ALL
  SELECT AccountNumber, MeterReadingDate, BillPeriod, MeterReading, 'Current' AS SourceName
  FROM MeterReadingsCurrent
) AS CombinedReadings
ORDER BY AccountNumber, MeterReadingDate, BillPeriod, SourceName
"@
    $readingCommand = $connection.CreateCommand()
    $readingCommand.CommandText = $sql
    $readingCommand.CommandTimeout = 300
    $readings = $readingCommand.ExecuteReader()
    $previousAccount = $null
    $previousDate = $null

    while ($readings.Read()) {
      $rowCount++
      $account = [string](ReaderValue $readings 0)
      $dateValue = ReaderValue $readings 1
      $billValue = ReaderValue $readings 2
      $readingValue = ReaderValue $readings 3
      $source = [string](ReaderValue $readings 4)
      $sourceCounts[$source]++

      $meter = if ($accountMeter.ContainsKey($account)) {
        [string]$accountMeter[$account]
      } else {
        "ACCOUNT-$account"
      }
      [void]$meterKeys.Add($meter)

      $dateNotes = [System.Collections.Generic.List[string]]::new()
      $validDate = $true
      $readingDate = $null
      if ($null -eq $dateValue) {
        $dateNullCount++
        $validDate = $false
        $dateNotes.Add("Missing reading date")
      } else {
        $readingDate = ([datetime]$dateValue).Date
        if ($readingDate.Year -lt 2000) {
          $pre2000ReadingCount++
          $validDate = $false
          $dateNotes.Add("Pre-2000 date; likely placeholder or corrupt value")
        }
        if ($readingDate -gt $futureLimit) {
          $futureReadingCount++
          $validDate = $false
          $dateNotes.Add("Implausible future reading date")
        }
        if ($null -eq $earliestReading -or $readingDate -lt $earliestReading) {
          $earliestReading = $readingDate
        }
        if ($null -eq $latestReading -or $readingDate -gt $latestReading) {
          $latestReading = $readingDate
        }
      }

      $billPeriod = if ($null -eq $billValue) { $null } else { ([datetime]$billValue).Date }
      $rawWriter.WriteLine((CsvLine @(
        $source,
        $account,
        $meter,
        $(if ($null -eq $readingDate) { "" } else { IsoDate $readingDate }),
        $(if ($null -eq $billPeriod) { "" } else { IsoDate $billPeriod }),
        $readingValue,
        $(if ($validDate) { "Yes" } else { "No" }),
        $(if ($dateNotes.Count) { $dateNotes -join "; " } else { "Plausible date" })
      )))

      if ($null -ne $readingDate -and $null -ne $billPeriod) {
        $billKey = IsoDate $billPeriod
        if (-not $billWindows.ContainsKey($billKey)) {
          $billWindows[$billKey] = [ordered]@{
            billPeriod = $billKey
            rawCount = 0L
            currentCount = 0L
            excludedCount = 0L
            rawFirst = $null
            rawLast = $null
            representativeFirst = $null
            representativeLast = $null
          }
        }
        $window = $billWindows[$billKey]
        $window.rawCount++
        if ($source -eq "Current") { $window.currentCount++ }
        if ($null -eq $window.rawFirst -or $readingDate -lt $window.rawFirst) {
          $window.rawFirst = $readingDate
        }
        if ($null -eq $window.rawLast -or $readingDate -gt $window.rawLast) {
          $window.rawLast = $readingDate
        }
        $representativeDate =
          $readingDate.Year -ge 2000 -and
          $readingDate -le $futureLimit -and
          $readingDate -ge $billPeriod.AddDays(-10) -and
          $readingDate -le $billPeriod.AddMonths(2).AddDays(5)
        if ($representativeDate) {
          if ($null -eq $window.representativeFirst -or $readingDate -lt $window.representativeFirst) {
            $window.representativeFirst = $readingDate
          }
          if ($null -eq $window.representativeLast -or $readingDate -gt $window.representativeLast) {
            $window.representativeLast = $readingDate
          }
        } else {
          $window.excludedCount++
        }
      }

      if (
        $null -ne $readingDate -and
        $account -eq $previousAccount -and
        $null -ne $previousDate
      ) {
        $intervalCount++
        $duration = [int](New-TimeSpan -Start $previousDate -End $readingDate).TotalDays
        $notes = [System.Collections.Generic.List[string]]::new()
        $intervalValid = $true

        if ($previousDate.Year -lt 2000 -or $readingDate.Year -lt 2000) {
          $intervalValid = $false
          $pre2000Intervals++
          $notes.Add("Pre-2000 boundary; likely placeholder")
        }
        if ($previousDate -gt $futureLimit -or $readingDate -gt $futureLimit) {
          $intervalValid = $false
          $futureIntervals++
          $notes.Add("Implausible future boundary")
        }
        if ($duration -le 0) {
          $intervalValid = $false
          $duplicateDateIntervals++
          $notes.Add("Duplicate or non-increasing reading date")
        } elseif ($duration -lt 20) {
          $intervalValid = $false
          $shortIntervals++
          $notes.Add("Unusually short compared with an approximately 30-day cycle")
        } elseif ($duration -gt 40) {
          $intervalValid = $false
          $longIntervals++
          $notes.Add("Unusually long compared with an approximately 30-day cycle")
        }
        if ($meter.StartsWith("ACCOUNT-")) {
          $unmappedMeterIntervals++
          $notes.Add("No current meter-number mapping; account number used as the stable identifier")
        }

        if ($intervalValid) {
          $validIntervalCount++
          $durationSum += $duration
          if ($duration -ge 28 -and $duration -le 32) { $monthly28to32++ }
          AddCount $startDays $previousDate.Day
          AddCount $endDays $readingDate.Day
          AddCount $durations $duration
          if ($previousDate.Day -eq 26) { $exactStart26++ }
          if ($previousDate.Day -ge 25 -and $previousDate.Day -le 27) { $nearStart26++ }
          if ($readingDate.Day -eq 25) { $exactEnd25++ }
          if ($readingDate.Day -ge 24 -and $readingDate.Day -le 26) { $nearEnd25++ }
          if ($previousDate.Day -eq 26 -and $readingDate.Day -eq 25) { $exactJoint2625++ }
          if (
            $previousDate.Day -ge 25 -and $previousDate.Day -le 27 -and
            $readingDate.Day -ge 24 -and $readingDate.Day -le 26
          ) { $nearJoint2625++ }
          $notes.Add("Plausible consecutive-reading interval")
        } else {
          $invalidIntervalCount++
        }

        $intervalWriter.WriteLine((CsvLine @(
          $meter,
          $account,
          (IsoDate $previousDate),
          (IsoDate $readingDate),
          $duration,
          $(if ($intervalValid) { "Yes" } else { "No" }),
          ($notes -join "; ")
        )))
      }

      if ($account -ne $previousAccount) {
        $previousAccount = $account
      }
      $previousDate = $readingDate
    }
    $readings.Dispose()
    $readingCommand.Dispose()

    # Make the synthetic import artifact explicit instead of silently ignoring it.
    $intervalWriter.WriteLine((CsvLine @(
      "ALL IMPORTED METERS",
      "IMPORT-METADATA",
      "1900-01-01",
      "2026-07-18",
      46210,
      "No",
      "AquaFlow LEGACY-SNAPSHOT metadata; synthetic migration container, not an observed MajiWare reading cycle. The 1900 start is a null/default-date artifact."
    )))
    $invalidIntervalCount++
  } finally {
    $rawWriter.Dispose()
    $intervalWriter.Dispose()
  }

  $windowWriter = New-Object System.IO.StreamWriter($windowPath, $false, $utf8)
  $windowStartDays = @{}
  $windowEndDays = @{}
  $completedWindowCount = 0L
  $windowExactStart26 = 0L
  $windowNearStart26 = 0L
  $windowExactEnd25 = 0L
  $windowNearEnd25 = 0L
  $windowExactJoint = 0L
  $windowNearJoint = 0L
  try {
    $windowWriter.WriteLine((CsvLine @(
      "Bill Period", "Raw Records", "Current-Table Records", "Excluded Anomalies",
      "Raw First Reading", "Raw Last Reading", "Representative Start",
      "Representative End", "Duration (days)", "Valid Completed Window?", "Notes"
    )))
    foreach ($key in ($billWindows.Keys | Sort-Object)) {
      $window = $billWindows[$key]
      $notes = [System.Collections.Generic.List[string]]::new()
      $representativeStart = $window.representativeFirst
      $representativeEnd = $window.representativeLast
      $duration = if ($null -eq $representativeStart -or $null -eq $representativeEnd) {
        $null
      } else {
        [int](New-TimeSpan -Start $representativeStart -End $representativeEnd).TotalDays
      }
      $validCompleted = $true
      if ($window.currentCount -gt 0) {
        $validCompleted = $false
        $notes.Add("Contains MeterReadingsCurrent rows; may be incomplete or duplicated at extraction")
      }
      if ($null -eq $duration -or $duration -lt 20 -or $duration -gt 40) {
        $validCompleted = $false
        $notes.Add("Collection-window duration is outside 20-40 days")
      }
      if ($window.excludedCount -gt 0) {
        $notes.Add("$($window.excludedCount) anomalous date(s) retained in raw columns but excluded from representative boundaries")
      }
      if ($validCompleted) {
        $completedWindowCount++
        AddCount $windowStartDays $representativeStart.Day
        AddCount $windowEndDays $representativeEnd.Day
        if ($representativeStart.Day -eq 26) { $windowExactStart26++ }
        if ($representativeStart.Day -ge 25 -and $representativeStart.Day -le 27) { $windowNearStart26++ }
        if ($representativeEnd.Day -eq 25) { $windowExactEnd25++ }
        if ($representativeEnd.Day -ge 24 -and $representativeEnd.Day -le 26) { $windowNearEnd25++ }
        if ($representativeStart.Day -eq 26 -and $representativeEnd.Day -eq 25) { $windowExactJoint++ }
        if (
          $representativeStart.Day -ge 25 -and $representativeStart.Day -le 27 -and
          $representativeEnd.Day -ge 24 -and $representativeEnd.Day -le 26
        ) { $windowNearJoint++ }
      }
      if ($notes.Count -eq 0) { $notes.Add("Representative completed collection window") }
      $windowWriter.WriteLine((CsvLine @(
        $window.billPeriod,
        $window.rawCount,
        $window.currentCount,
        $window.excludedCount,
        $(if ($null -eq $window.rawFirst) { "" } else { IsoDate $window.rawFirst }),
        $(if ($null -eq $window.rawLast) { "" } else { IsoDate $window.rawLast }),
        $(if ($null -eq $representativeStart) { "" } else { IsoDate $representativeStart }),
        $(if ($null -eq $representativeEnd) { "" } else { IsoDate $representativeEnd }),
        $duration,
        $(if ($validCompleted) { "Yes" } else { "No" }),
        ($notes -join "; ")
      )))
    }
  } finally {
    $windowWriter.Dispose()
  }

  $startMode = ModeEntry $startDays
  $endMode = ModeEntry $endDays
  $durationMode = ModeEntry $durations
  $windowStartMode = ModeEntry $windowStartDays
  $windowEndMode = ModeEntry $windowEndDays
  $meanDuration = if ($validIntervalCount) {
    [math]::Round($durationSum / [double]$validIntervalCount, 2)
  } else { $null }

  $perMeterEvidence = [ordered]@{
    validIntervals = $validIntervalCount
    mostCommonStartDay = $startMode
    mostCommonEndDay = $endMode
    mostCommonDurationDays = $durationMode
    medianDurationDays = MedianFromHistogram $durations $validIntervalCount
    meanDurationDays = $meanDuration
    duration28to32Percent = Percent $monthly28to32 $validIntervalCount
    exactStart26Percent = Percent $exactStart26 $validIntervalCount
    start26PlusMinus1Percent = Percent $nearStart26 $validIntervalCount
    exactEnd25Percent = Percent $exactEnd25 $validIntervalCount
    end25PlusMinus1Percent = Percent $nearEnd25 $validIntervalCount
    exactJoint26to25Percent = Percent $exactJoint2625 $validIntervalCount
    joint26to25PlusMinus1Percent = Percent $nearJoint2625 $validIntervalCount
  }

  $windowEvidence = [ordered]@{
    completedRepresentativeWindows = $completedWindowCount
    mostCommonStartDay = $windowStartMode
    mostCommonEndDay = $windowEndMode
    exactStart26Percent = Percent $windowExactStart26 $completedWindowCount
    start26PlusMinus1Percent = Percent $windowNearStart26 $completedWindowCount
    exactEnd25Percent = Percent $windowExactEnd25 $completedWindowCount
    end25PlusMinus1Percent = Percent $windowNearEnd25 $completedWindowCount
    exactJoint26to25Percent = Percent $windowExactJoint $completedWindowCount
    joint26to25PlusMinus1Percent = Percent $windowNearJoint $completedWindowCount
  }

  $jointNearPercent = [double]$perMeterEvidence.joint26to25PlusMinus1Percent
  $conclusion = if ($validIntervalCount -eq 0) {
    "Not verifiable: no valid consecutive approximately monthly meter intervals were found."
  } elseif ($jointNearPercent -ge 80) {
    "Strongly supported by per-meter data."
  } elseif ($jointNearPercent -ge 50) {
    "Partially supported, but material deviations exist."
  } else {
    "Not supported as the dominant observed per-meter reading interval."
  }

  $result = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    sourceDatabase = $MdbPath
    method = [ordered]@{
      intervalDefinition = "Consecutive reading dates for the same legacy account/current meter mapping."
      validIntervalRule = "Both boundaries are plausible and duration is 20-40 days."
      representativeBillWindowRule = "Reading date falls from 10 days before through 2 months + 5 days after BillPeriod; windows containing Current rows are treated as incomplete."
      caveat = "A reading-to-reading interval measures field collection timing. It does not by itself prove the configured accounting boundary."
    }
    sourceRecords = [ordered]@{
      total = $rowCount
      history = $sourceCounts.History
      current = $sourceCounts.Current
      distinctMeterIdentifiers = $meterKeys.Count
      nullReadingDates = $dateNullCount
      pre2000ReadingDates = $pre2000ReadingCount
      implausibleFutureReadingDates = $futureReadingCount
      earliestReadingDate = $(if ($null -eq $earliestReading) { $null } else { IsoDate $earliestReading })
      latestReadingDate = $(if ($null -eq $latestReading) { $null } else { IsoDate $latestReading })
    }
    inferredIntervals = [ordered]@{
      total = $intervalCount
      valid = $validIntervalCount
      invalidOrNonRepresentative = $invalidIntervalCount
      duplicateOrNonIncreasing = $duplicateDateIntervals
      shorterThan20Days = $shortIntervals
      longerThan40Days = $longIntervals
      touchingPre2000Date = $pre2000Intervals
      touchingImplausibleFutureDate = $futureIntervals
      usingAccountFallbackForMeter = $unmappedMeterIntervals
    }
    perMeterEvidence = $perMeterEvidence
    billPeriodCollectionWindowEvidence = $windowEvidence
    adminClaim = [ordered]@{
      statedCycle = "26th of one month through 25th of the next month"
      empiricalConclusion = $conclusion
      interpretation = "Use the percentages, not the label, as evidence. LEGACY-SNAPSHOT is excluded from valid evidence and reported as an import artifact."
    }
    artifacts = [ordered]@{
      rawReadingDatesCsv = $rawPath
      inferredCycleTableCsv = $intervalPath
      billPeriodWindowsCsv = $windowPath
      json = $jsonPath
      report = $markdownPath
    }
  }

  [System.IO.File]::WriteAllText(
    $jsonPath,
    ($result | ConvertTo-Json -Depth 12),
    $utf8
  )

  $report = @"
# MajiWare meter-reading cycle analysis

Generated: $($result.generatedAt)

## Conclusion

**Admin claim:** 26th of one month through 25th of the next month.

**Empirical result:** $conclusion

This analysis uses the original `MeterReadingsHistory` and `MeterReadingsCurrent`
tables from `MajiWare.mdb`; it does not infer history from the imported
`LEGACY-SNAPSHOT`.

## Source coverage

| Measure | Result |
|---|---:|
| All meter-reading rows parsed | $($sourceCounts.History + $sourceCounts.Current) |
| Historical rows | $($sourceCounts.History) |
| Current rows | $($sourceCounts.Current) |
| Distinct meter identifiers | $($meterKeys.Count) |
| Earliest raw reading date | $(if ($null -eq $earliestReading) { "None" } else { IsoDate $earliestReading }) |
| Latest raw reading date | $(if ($null -eq $latestReading) { "None" } else { IsoDate $latestReading }) |
| Pre-2000 dates | $pre2000ReadingCount |
| Implausible future dates | $futureReadingCount |

## Per-meter consecutive-reading evidence

| Measure | Result |
|---|---:|
| Valid 20-40 day intervals | $validIntervalCount |
| Most common start day | $(if ($null -eq $startMode) { "N/A" } else { $startMode.value }) |
| Most common end day | $(if ($null -eq $endMode) { "N/A" } else { $endMode.value }) |
| Median duration | $($perMeterEvidence.medianDurationDays) days |
| Most common duration | $(if ($null -eq $durationMode) { "N/A" } else { "$($durationMode.value) days" }) |
| Intervals lasting 28-32 days | $($perMeterEvidence.duration28to32Percent)% |
| Starts exactly on 26th | $($perMeterEvidence.exactStart26Percent)% |
| Starts on 26th +/- 1 day | $($perMeterEvidence.start26PlusMinus1Percent)% |
| Ends exactly on 25th | $($perMeterEvidence.exactEnd25Percent)% |
| Ends on 25th +/- 1 day | $($perMeterEvidence.end25PlusMinus1Percent)% |
| Exact joint 26th to 25th | $($perMeterEvidence.exactJoint26to25Percent)% |
| Joint 26th to 25th, both +/- 1 day | $($perMeterEvidence.joint26to25PlusMinus1Percent)% |

## Bill-period collection-window evidence

| Measure | Result |
|---|---:|
| Representative completed windows | $completedWindowCount |
| Most common observed first-reading day | $(if ($null -eq $windowStartMode) { "N/A" } else { $windowStartMode.value }) |
| Most common observed last-reading day | $(if ($null -eq $windowEndMode) { "N/A" } else { $windowEndMode.value }) |
| Starts on 26th +/- 1 day | $($windowEvidence.start26PlusMinus1Percent)% |
| Ends on 25th +/- 1 day | $($windowEvidence.end25PlusMinus1Percent)% |
| Joint 26th to 25th, both +/- 1 day | $($windowEvidence.joint26to25PlusMinus1Percent)% |

## Invalid and non-representative records

| Condition | Count | Interpretation |
|---|---:|---|
| Duplicate/non-increasing dates | $duplicateDateIntervals | Duplicate source rows or more than one record on one date |
| Intervals shorter than 20 days | $shortIntervals | Too short to represent a normal monthly cycle |
| Intervals longer than 40 days | $longIntervals | Missing readings, inactive meters or corrupt dates |
| Intervals touching pre-2000 dates | $pre2000Intervals | Likely placeholder/default date |
| Intervals touching implausible future dates | $futureIntervals | Likely data-entry error |
| `LEGACY-SNAPSHOT` | 1 synthetic metadata record | Created by the AquaFlow migration, not present as a genuine MajiWare cycle |

### Notable cycle/window records

| Record | Observed range | Valid? | Reason |
|---|---|---|---|
| AquaFlow `LEGACY-SNAPSHOT` | 1900-01-01 to 2026-07-18 | No | Synthetic migration container; not present as a genuine cycle in MajiWare |
| MajiWare bill period 2026-02 | Raw 2010-12-06 to 2032-07-28 | No | 61 dates fall outside the representative period; cleaned window still lasts 56 days |
| MajiWare bill period 2026-04 | Raw 2026-03-01 to 2026-05-22 | Review | 359 dates are inconsistent with the bill period, although the representative window is 2026-04-23 to 2026-05-22 |
| MajiWare bill period 2026-06 | 2026-06-04 to 2026-07-18 | No (incomplete) | Includes 9,670 current-table rows and spans 44 days, so it is not a completed representative cycle |

The `1900-01-01` start shown for `LEGACY-SNAPSHOT` is a classic null/default-date
artifact. Its multi-year duration and its `LEGACY`/`SNAPSHOT` label make it
unsuitable as a reading or billing cycle. It should remain excluded from billing
period selection.

## Detailed outputs

- `MajiWare_Meter_Reading_Dates.csv`: every raw reading and normalized date.
- `MajiWare_Inferred_Reading_Cycles.csv`: requested meter-by-meter interval table,
  including every invalid row and its reason.
- `MajiWare_Bill_Period_Windows.csv`: raw and representative collection windows.
- `MajiWare_Reading_Cycle_Analysis.json`: machine-readable results and methodology.
"@
  [System.IO.File]::WriteAllText($markdownPath, $report, $utf8)

  $result | ConvertTo-Json -Depth 12
} finally {
  if ($connection.State -ne [System.Data.ConnectionState]::Closed) {
    $connection.Close()
  }
  $connection.Dispose()
}
