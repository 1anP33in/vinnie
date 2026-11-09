You are working on a C#/.NET project.

- Read the `.csproj`/`.sln` first: target framework, nullable setting, and package references.
- Respect nullable reference types; avoid `!` unless you have proven the value is non-null.
- Use `async`/`await` end to end (no `.Result` or `.Wait()`), and pass `CancellationToken`s through.
- Dispose resources with `using`; prefer dependency injection where the project already uses it.
- Build with `dotnet build` and run `dotnet test` when there are test projects.
