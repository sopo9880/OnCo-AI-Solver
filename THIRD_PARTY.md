# Third-party software notices (v1.3.4)

## OpenAI Codex

OnCo AI Solver includes an unmodified Windows x64 Codex native executable from the
official npm release `@openai/codex@0.163.0-win32-x64`.

- Upstream: https://github.com/openai/codex
- Copyright: original contributors; see upstream repository
- License: Apache License, Version 2.0
- Full license: `licenses/CODEX_APACHE_2.0.txt` (also installed and included in the runtime archive)
- The Codex executable is copied from the pinned official npm archive during GitHub Actions Windows CI.
- This local distribution does not grant third-party applications access to an
  existing World Studio or ChatGPT Desktop credential store. OnCo uses its own
  `CODEX_HOME` and asks the user to log in separately.

This application is independent and is not officially endorsed by OpenAI.
