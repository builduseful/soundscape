[![Deploy web app to Azure Static Web Apps](https://github.com/jamesdeklerk/soundscape/actions/workflows/azure-staticwebapp.yml/badge.svg)](https://github.com/jamesdeklerk/soundscape/actions/workflows/azure-staticwebapp.yml)

## Testing

Run the dependency-free test suite with:

```sh
node --test
```

`npm test` runs the same command when npm is available. The tests use Node's built-in test runner with fakes for the browser audio and media-session APIs.
