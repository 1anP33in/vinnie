Debug systematically.

1. Reproduce: find the exact error message, stack trace, or failing command. Run it if you can.
2. Locate: search for the error text and the functions in the stack trace; read the code around them.
3. Explain the root cause in one or two sentences before changing anything. Don't patch symptoms.
4. Make the smallest fix for that cause, and keep unrelated code unchanged.
5. Verify: run the failing command or test again, and say what you ran and what it showed.
If you can't reproduce the problem, say so and list what you checked.
