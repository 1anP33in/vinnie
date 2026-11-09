# fxmanifest.lua quick reference

```lua
fx_version 'cerulean'
game 'gta5'
lua54 'yes'

author 'Name'
description 'What the resource does'
version '1.0.0'

shared_scripts { '@ox_lib/init.lua', 'config.lua' }
client_scripts { 'client/*.lua' }
server_scripts { '@oxmysql/lib/MySQL.lua', 'server/*.lua' }

ui_page 'html/index.html'
files { 'html/index.html', 'html/style.css', 'html/app.js' }

dependencies { 'ox_lib', 'oxmysql' }
```

- `@resource/path` loads a file from another resource (it must be started first).
- Globs like `client/*.lua` are allowed in script lists.
- After editing the manifest run `refresh` and then `ensure <resource>`.
