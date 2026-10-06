# Amharic/calendar regression follow-up

1. **Evidence:** user supplied Dashboard collectionSeries stack: Ethiopian month
   13 formatted as Gregorian. The supplied log also sends a Gregorian year key
   with calendar=ethiopian, behavior from before PR #16. Confirm local commit and
   restart before assuming a new backend error. Initial 401s refresh successfully.
2. **Changes:** top-bar date now uses the selected language, not hardcoded English.
   Existing Amharic month tables use Ethiopic script for all 13 Ethiopian and 12
   Gregorian months. Charges now uses the same calendar-owned period state as
   Dashboard/Reports, preventing Pagume reinterpretation there too.
3. **Tests:** actual Dashboard component and real async hook with mocked network:
   load Ethiopian Pagume, switch to Amharic, switch Gregorian while response is
   delayed, return Ethiopian; also late Ethiopian response after Gregorian loads.
   Top-bar Amharic script regression and all 25 month-script assertions. 86 web
   tests and 60 calendar tests pass locally. This is jsdom, NOT real Cloud Shell
   browser acceptance. PR #16's fix passes the exact reported sequence locally.
4. **Run:** stop dev:all, git switch main, git pull --ff-only, pnpm install
   --frozen-lockfile, pnpm dev:all; hard-refresh the browser. Confirm main contains
   8a64917 (PR #16) and this follow-up. No database reset/reseed/cache deletion.
5. **Next:** retest Dashboard/Reports/Charges in Amharic and switch calendars both
   directions. If it still fails, send git log -1 --oneline and the current stack.
   UI redesign remains paused. No financial posting rules or data changed here.
