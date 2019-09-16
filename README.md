# npm-sync-for-web-components

This will listen for changes on the npm registry.

If a change is a new package containing a `custom-elements.json` it will get added to the faunadb via a graphql query.
