// Retained upstream response types, copied from ../vendor/backend-client/src/types.rs:109-125.
// Upstream commit and complete-file SHA-256 are in ../provenance.json.
#[derive(Clone, Debug)]
pub struct AccountsCheckResponse {
    pub accounts: Vec<AccountEntry>,
    pub account_ordering: Vec<String>,
    pub default_account_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AccountEntry {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub profile_picture_url: Option<String>,
    #[serde(default)]
    pub structure: String,
}
