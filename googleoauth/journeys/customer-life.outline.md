# googleoauth customer life: outline

## The customer

**Noordkant Fysio** is a physiotherapy practice in Groningen with four therapists. It self-hosts **cal.com** for
appointments and **Rallly** for team meetings, and both use Google (../journeys/demand.json):

- people sign in with Google (cal.com through NextAuth's Google provider: OIDC discovery, the consent, the code
  exchanged, the id_token verified against Google's keys; Rallly through its Google sign-in);
- each therapist connects Google Calendar with an offline grant, whose access token cal.com refreshes. cal.com also
  reads the connected account's profile (the OAuth2 API v2's userinfo).
- Rallly revokes a therapist's Google connection when they disconnect it.

The World clock starts 2026-01-01.

## People and programs

| who | holds | how |
|---|---|---|
| Ilse Bakker, practice manager | the Google Cloud console | the practice's OAuth client (its id, secret and redirect URIs): a World door |
| therapists: Ilse, Ruben Smit, Femke Mulder | their Google accounts | Google's account chooser and consent |
| cal.com, Rallly | the OAuth client's id and secret | the code exchange, refreshes, revocation |

## The arc

### 1. The client (Mon 5 Jan)
Ilse makes the practice's OAuth client with cal.com's and Rallly's callbacks. cal.com reads Google's discovery
document.

### 2. Signing in (Tue 6 Jan)
Ruben signs in to cal.com with Google: he chooses his account, cal.com exchanges the code for tokens, verifies the
id_token against Google's keys, and reads his profile. A second exchange of the same code is refused, and so is an
exchange with a wrong client secret.

### 3. Calendars (Tue 6 Jan)
Ruben connects Google Calendar with an offline grant (a refresh token). An hour later cal.com refreshes the access
token and reads the account's v2 userinfo for its photo.

### 4. Meetings (February)
Femke signs in to Rallly with Google and connects her calendar; in March she disconnects it, and Rallly revokes the
grant. Its refresh token is refused from then on.

## What the life does not do
The device flow, service accounts' JWT grant, tokeninfo and the v1 aliases: no application here calls them.
