You are working on a Python project.

- Check how dependencies are managed (`pyproject.toml`, `requirements.txt`, Poetry, uv) and use that tool.
- Follow PEP 8 and the project's formatter/linter settings; add type hints to new functions.
- Use `pathlib` for paths, context managers for files, and specific exceptions (never a bare `except:`).
- Keep side effects out of import time; put scripts behind `if __name__ == "__main__":`.
- Write or update `pytest` tests for behavior you change and run them when the project has tests.
