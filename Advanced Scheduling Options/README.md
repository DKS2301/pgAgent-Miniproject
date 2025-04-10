# Advanced Job Scheduling in pgAgent

## Overview

This project enhances pgAgent's scheduling capabilities by adding support for complex scheduling patterns, particularly focusing on occurrence-based scheduling (e.g., "2nd Saturday of every month").

## Key Modifications

### 1. Frontend Changes (pgAdmin)

#### UI Enhancements

- Added new occurrence dropdown field in the schedule creation interface
- Implemented in `pga_schedule.ui.js` and `repeat.ui.js`
- Enhanced form validation and data handling for occurrence-based scheduling

#### Constants and Configuration

- Added new constants in `constants.js`:
  ```javascript
  OCCURRENCE = [
    { label: gettext("1st"), value: "1" },
    { label: gettext("2nd"), value: "2" },
    { label: gettext("3rd"), value: "3" },
    { label: gettext("4th"), value: "4" },
    { label: gettext("last"), value: "5" },
  ];
  ```

### 2. Backend Changes (pgAgent)

#### Database Schema Modifications

- Added new column in `pgagent.pga_schedule` table:
  ```sql
  jscoccurrence bool[5] NOT NULL DEFAULT '{f,f,f,f,f}'
  ```
- Updated triggers and functions to handle occurrence-based scheduling

#### Scheduling Logic

- Enhanced `pga_next_schedule` function to handle occurrence-based scheduling
- Added support for:
  - First occurrence of a weekday in a month
  - Second occurrence of a weekday in a month
  - Third occurrence of a weekday in a month
  - Fourth occurrence of a weekday in a month
  - Last occurrence of a weekday in a month

### 3. Template and Macro Changes

- Updated `pga_schedule.macros` to handle occurrence data in SQL operations
- Modified INSERT and UPDATE macros to include occurrence field
- Enhanced property fetching to include occurrence information

## Technical Implementation Details

### 1. Frontend Implementation

- Added new form fields in `pga_schedule.ui.js`:
  ```javascript
  {
    id: 'jscoccurrence',
    label: gettext('Occurrence'),
    type: 'select',
    group: gettext('Days'),
    controlProps: {
      allowClear: true,
      multiple: true,
      allowSelectAll: true,
      placeholder: gettext('Select the occurrence...'),
      formatter: BooleanArrayFormatter
    },
    options: OCCURRENCE
  }
  ```

### 2. Backend Implementation

- Enhanced scheduling logic in `pga_next_schedule` function:

  ```sql
  -- Check for occurrence
  gotit := FALSE;
  FOR i IN 1 .. 5 LOOP
      IF jscoccurrence[i] = TRUE THEN
          gotit := TRUE;
          EXIT;
      END IF;
  END LOOP;

  IF gotit = TRUE THEN
      -- finding current occurrence
      occurrence := 0; -- Reset occurrence counter before calculation
      curr_date := date_trunc(''MONTH'', nextrun);
      WHILE curr_date <= nextrun LOOP
          IF date_part(''DOW'', curr_date) = date_part(''DOW'', nextrun) THEN
              occurrence := occurrence + 1;
          END IF;
          curr_date := curr_date + INTERVAL ''1 Day'';
      END LOOP;
      -- is it the correct occurrence?
      IF jscoccurrence[occurrence] = TRUE THEN
          -- Check for exceptions
          SELECT INTO d jexid FROM pgagent.pga_exception WHERE jexscid = jscid AND ((jexdate = nextrun::date AND jextime = nextrun::time) OR (jexdate = nextrun::date AND jextime IS NULL) OR (jexdate IS NULL AND jextime = nextrun::time));
          IF FOUND THEN
              -- Nuts - found an exception. Increment the time and try again
              runafter := nextrun + INTERVAL ''1 Minute'';
              bingo := FALSE;
              minutetweak := TRUE;
              daytweak := FALSE;
          ELSE
              bingo := TRUE;
          END IF;
      ELSE
          -- We''re on the wrong occurrence of week day - increment a day and try again.
          runafter := nextrun + INTERVAL ''1 Day'';
          bingo := FALSE;
          minutetweak := FALSE;
          daytweak := TRUE;
      END IF;
  ELSE
      -- Check for exceptions
      SELECT INTO d jexid FROM pgagent.pga_exception WHERE jexscid = jscid AND ((jexdate = nextrun::date AND jextime = nextrun::time) OR (jexdate = nextrun::date AND jextime IS NULL) OR (jexdate IS NULL AND jextime = nextrun::time));
      IF FOUND THEN
          -- Nuts - found an exception. Increment the time and try again
          runafter := nextrun + INTERVAL ''1 Minute'';
          bingo := FALSE;
          minutetweak := TRUE;
          daytweak := FALSE;
      ELSE
          bingo := TRUE;
      END IF;
  END IF;
  ```

## Preview

### Working Demo

https://github.com/user-attachments/assets/22a5f704-c360-4b87-a31c-fc5434177ea0

## Usage Examples

### Creating a Schedule for 2nd Saturday of Every Month

1. In pgAdmin, create a new schedule
2. Select "Saturday" in the Week Days section
3. Select "2nd" in the Occurrence dropdown
4. Configure other parameters as needed

### Creating a Schedule for Last Monday of Every Month

1. In pgAdmin, create a new schedule
2. Select "Monday" in the Week Days section
3. Select "last" in the Occurrence dropdown
4. Configure other parameters as needed

## Testing

To verify the implementation:

1. Create schedules with different occurrence patterns
2. Verify the schedules execute on the correct dates
3. Check the job logs for proper execution
4. Validate the UI displays the correct scheduling information

## Known Limitations

- Occurrence-based scheduling is limited to weekdays within a month
- The "last" occurrence option may not work as expected for months with varying numbers of days

## Future Enhancements

- Support for more complex patterns (e.g., "every other 2nd Saturday")
- Enhanced validation for occurrence-based scheduling
- Improved UI feedback for complex scheduling patterns

## License

This enhancement is released under the PostgreSQL License, consistent with the original pgAgent project.

## Acknowledgments

- pgAdmin Development Team for the base implementation
- PostgreSQL Global Development Group for pgAgent
- Contributors to the original scheduling logic
