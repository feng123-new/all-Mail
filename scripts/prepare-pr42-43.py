#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).with_name("apply-pr42-43-core.py")
content = path.read_text(encoding="utf-8")
content = content.replace("'''len(first.CreatedKeys) != 2''',\n    '''len(first.CreatedKeys) != 5'''", "'''len(first.CreatedKeys) != 3''',\n    '''len(first.CreatedKeys) != 6'''")
marker = '''replace_once(\n    "core/internal/secretstate/secretstate_test.go",\n    ''' + "'''len(first.CreatedKeys) != 3'''" + ''',\n    ''' + "'''len(first.CreatedKeys) != 6'''" + ''',\n)\n'''
addition = marker + '''replace_once(\n    "core/internal/secretstate/secretstate_test.go",\n    ''' + "'''len(state.RedisPassword) != 64 || len(state.CreatedKeys) != 1 || state.CreatedKeys[0] != \"REDIS_PASSWORD\"'''" + ''',\n    ''' + "'''len(state.RedisPassword) != 64 || len(state.CreatedKeys) != 4 || state.CreatedKeys[0] != \"REDIS_PASSWORD\"'''" + ''',\n)\n'''
if marker not in content:
    raise SystemExit("updated secret test marker missing")
content = content.replace(marker, addition, 1)
path.write_text(content, encoding="utf-8")
