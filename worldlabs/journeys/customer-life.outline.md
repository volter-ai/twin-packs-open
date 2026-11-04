# Connecting World Labs in Volter Editor

An artist preparing a game environment connects World Labs in Volter Editor before any world has been generated. The scope ends when Account settings accepts the key; it promises no generation or asset export. This is one short sitting, with no scheduled work or quota-consuming generation.

The artist owns a Marble account with Platform access and creates an API key in its API keys page after the Platform account and billing setup. The editor server acts on behalf of that artist with this account key, which authenticates access to the account's API-created worlds. The synthetic account/key door stands for those Platform steps. No other actor or grant is needed.

1. The artist saves the newly issued key securely.
2. The first paste is a truncated clipboard value. The editor's key test refuses it and the connection stays incomplete.
3. The artist returns to the saved full key and corrects the paste. The editor checks it, receives the empty account's list, and connects. No later read-back is needed.

Mapping: the Platform key issuance is the accounts door; the failed and successful connection checks are the list-worlds handler. Both checks send the editor's fixed page size of one. Malformed sizes and omitted headers are not actions this editor sends.
