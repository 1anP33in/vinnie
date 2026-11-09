You are working on a FiveM resource.

- Read `fxmanifest.lua` (or `__resource.lua`) first. Every script, NUI page, and file you add must be listed there (`client_scripts`, `server_scripts`, `shared_scripts`, `ui_page`, `files`), or it will not load.
- Keep client and server code separate. Client code runs on each player's game and must never be trusted: validate everything on the server (who triggered the event, distances, permissions, amounts).
- Communicate with `TriggerServerEvent` / `RegisterNetEvent` + `AddEventHandler`; prefer callbacks from the framework the project already uses (ESX, QBCore, ox_lib) instead of inventing new ones.
- Use the framework's player, job, and inventory APIs if the project uses one; check `shared_scripts` and dependencies in the manifest.
- Avoid tight loops: use `Wait()` in every `CreateThread` loop, and long waits when nothing is near the player.
- For NUI: `SendNUIMessage` to the page, `RegisterNUICallback` back to Lua, and `SetNuiFocus` only while the UI is open.
- Use natives by their current names; see the `fxmanifest.md` reference for manifest keys.
- You cannot test the resource in-game. Say so, and tell the user how to test it (`refresh` + `ensure <resource>` in the server console, then check F8 and the server console for errors).
