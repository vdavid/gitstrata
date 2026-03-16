# Style guide

Writing and code styles.

## Writing

- Wording
    - **Use a friendly style**: Make all texts informal, friendly, encouraging, and concise.
    - **Always prefer active voice**: Active voice is direct and clear. Passive voice feels bureaucratic.
      "We released a new feature" not "A new feature was released." "Add a repo" not "A repo can be added."
    - **Use verbs, not verb-noun phrases**: "Search" not "Make a search." "Analyze" not "Perform an analysis."
    - **Don't use permissive language**: Give users confidence. "Add repos and start searching" not "Add repos and you
      can start searching."
    - **Abbreviate English**: Use "I'm", "don't", and such.
    - **Don't trivialize**: Avoid terminology of "just", "simple", "easy", and "all you have to do".
    - **Use gender-neutral language**: Use they/them rather than he/him/she/her. Use "folks" or "everyone" rather than
      "guys".
    - **Use universally understood terms**: Use "start" instead of "kickoff", and "end" instead of "wrap up".
    - **Avoid ableist language**: "placeholder value" rather than "dummy value". No "lame", "sanity check" which derive
      from disabilities.
    - **Avoid violent terms**: "stop a process" rather than "kill" or "nuke" it.
    - **Avoid exclusionary terminology**: Prefer "primary/secondary" or "main/replica" over "master/slave". Use
      "allowlist/denylist" over "whitelist/blacklist".
    - **Be mindful of user expertise**: Avoid jargon. Link to definitions and explain concepts when necessary.
    - **Avoid latinisms**: For example, use "for example" instead of "e.g.".
    - **Avoid abbreviations**: Very common acronyms like "URL" are okay.
    - **Some casual terms are okay**: Use "docs", not "documentation". Use "dev" for developer and "gen" for generation
      where appropriate and understandable.
- Punctuation, capitalization, numbers
    - **Use sentence case in titles**: Regardless whether visible on the UI or dev only.
    - **Use sentence case in labels**: Applies to buttons, labels, and similar. But omit periods on short microcopy.
    - **Capitalize names correctly**: For example, there is GitHub but git.
    - **Use the Oxford comma**: Use "1, 2, and 3" rather than "1, 2 and 3".
    - **Use en dashes and em dashes**: en dash for ranges, em dash for combining thoughts.
    - **Use colon for lists**: Use the format I used in this list you're reading right now.
    - **Spell out numbers one through nine.** Use numerals for 10+.
    - **Use ISO dates**: Use YYYY-MM-DD wherever it makes sense.
- UI
    - Make **error messages** positive, actionable, and specific.
    - **Success messages**: Talk about the user, not the action. Make success implicit and warm.
      "You're in!" not "Login successful." "Repo added" not "The repository has been successfully added."
    - **Confirmation dialogs**: Title should be a verb+noun question ("Delete this repo?"). Body should be a plain
      irreversibility warning ("This can't be undone."). Buttons should be outcome verbs ("Delete" / "Keep"), never
      "Yes" / "No".
    - **Empty states**: Say what belongs here and offer a next step.
      "No repos yet. Add one to start tracking lines of code."
    - **Start UI actions with a verb**: This makes buttons and links more actionable. Use "Create user" instead of "New
      user".
    - **Link the destination, not the sentence**: Only link text that describes where you'll go.
      "Read the [style guide](...)." not "[Read the style guide](...)."
    - **Helper text**: Only add helper text if users actually need it. Keep it short and specific.
      "Must be a valid GitHub URL" not "Please enter the URL of the GitHub repository you would like to add."
    - **Give examples in placeholder text**: Use "Example: 2025-01-01" or "name@example.com" rather than an instruction
      like "Enter your email".
    - **Never write "something(s)"**: Always pluralize dynamically: "1 user" instead of "1 user(s)".
- Specific terms
    - **Folder vs directory**: We know these mean the same. We allow both. Use whichever feels better in each situation.
      Like, on the backend, listing "folders" with `readdir` feels wrong, but also, "folder" comes more natural on the
      front-end and end-user docs.

## Code

### Comments

Only add JSDoc that actually adds info. No tautologies.

- ✅ Add meaningful comments for public functions, methods, and types to help the next dev.
- ❌ DO NOT use JSDoc for stuff like `Gets the name` for a function called `getName` :D
- ✅ Before adding JSDoc, try using a more descriptive name for the function/param/variable.
- ❌ DO NOT repeat TypeScript types in `@param`/`@returns`.
- ⚠️ USE JSDoc to mark caveats, tricky/unusual solutions, formats (`YYYY-MM-DD`), and constraints (`must end with /`)
