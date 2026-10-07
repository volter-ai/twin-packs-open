// The instance's environment, the `/environment` family (spec:/components/schemas/Client.Environment): what clerk-js reads
// before it renders, and so what it offers. It offers what this twin serves: an email address and a password to sign up
// (the password where the instance takes one), the address verified by a code Clerk emails; sign-in by password or by an
// emailed code, and by an invitation's ticket;
// twins; no second factor and no enterprise provider. Organizations are
// what the instance says (the Backend API's instance settings, which a person sets on the Dashboard).
import type { HandlerContext } from '@volter/world-core';
import { authSettings, instanceEnvironment, ms, organizationSettings, PASSWORD_MIN_LENGTH, PROVIDERS, rootOf, type Row } from './shared.ts';

const attribute = (a: Partial<Record<string, unknown>> = {}): Row => ({
  enabled: false, required: false, used_for_first_factor: false, first_factors: [], used_for_second_factor: false, second_factors: [],
  verifications: [], verify_at_sign_up: false, immutable: false, ...a,
});

function environmentDoc(ctx: HandlerContext, root: HandlerContext): Row {
  const now = ms(ctx);
  const auth = authSettings(root);
  const environment = instanceEnvironment(root);
  const org = organizationSettings(root);
  const domains = (org.domains ?? {}) as Row;
  const origin = ctx.publicBase.replace(/\/$/, '');
  // The environment's and its configs' ids are fixed (one instance per World), each in the form of Clerk's ids, a type
  // prefix and 27 word characters (`^<prefix>_\w{27}$`, as the spec gives a user's id).
  // Where the documentation stops: Clerk publishes none of these three ids, so their words after the prefix are the twin's.
  // source: spec:getApiKeys "^user_\w{27}$"
  return {
    object: 'environment', id: 'env_2VOLTERENVIRONMENT000000001',
    auth_config: {
      object: 'auth_config', id: 'aac_2VOLTERAUTHCONFIG0000000001',
      first_name: 'on', last_name: 'on', email_address: 'required', phone_number: 'off', username: 'off', password: auth.password ? 'required' : 'off',
      identification_requirements: [['email_address']], identification_strategies: ['email_address'], first_factors: ['email_code', ...(auth.password ? ['password'] : [])],
      second_factors: [], email_address_verification_strategies: ['email_code'],
      single_session_mode: true, enhanced_email_deliverability: false, test_mode: environment === 'development', cookieless_dev: false, url_based_session_syncing: false,
      claimed_at: now, reverification: false,
      native_settings: { object: 'native_settings', api_enabled: false, trusted_device_sign_in_enabled: false, trusted_device_enrollment_prompt_after_sign_in_enabled: false, trusted_device_enrollment_prompt_after_sign_up_enabled: false },
    },
    display_config: {
      object: 'display_config', id: 'display_config_2VOLTERDISPLAYCONFIG0000001', instance_environment_type: environment, application_name: auth.applicationName, theme: {},
      preferred_sign_in_strategy: 'password', logo_image_url: '', favicon_image_url: '',
      home_url: 'http://localhost', sign_in_url: 'http://localhost/sign-in', sign_up_url: 'http://localhost/sign-up',
      user_profile_url: `${origin}/user`, waitlist_url: `${origin}/waitlist`, oauth_consent_url: `${origin}/oauth-consent`,
      after_sign_in_url: 'http://localhost', after_sign_up_url: 'http://localhost', after_sign_out_one_url: 'http://localhost',
      after_sign_out_all_url: 'http://localhost', after_switch_session_url: 'http://localhost', after_join_waitlist_url: 'http://localhost',
      organization_profile_url: `${origin}/organization`, create_organization_url: `${origin}/create-organization`,
      after_leave_organization_url: 'http://localhost', after_create_organization_url: 'http://localhost', logo_link_url: 'http://localhost',
      support_email: null, branded: false, experimental_force_oauth_first: false, clerk_js_version: '5', show_devmode_warning: false,
      google_one_tap_client_id: null, help_url: null, privacy_policy_url: null, terms_url: null, logo_url: null, favicon_url: null,
      logo_image: null, favicon_image: null, captcha_public_key: null, captcha_widget_type: null, captcha_public_key_invisible: null,
      captcha_provider: 'turnstile', captcha_oauth_bypass: [],
    },
    user_settings: {
      attributes: {
        email_address: attribute({ enabled: true, required: true, used_for_first_factor: true, first_factors: ['email_code'], verifications: ['email_code'], verify_at_sign_up: true }),
        phone_number: attribute(),
        username: attribute(),
        web3_wallet: attribute(),
        first_name: attribute({ enabled: true }),
        last_name: attribute({ enabled: true }),
        password: attribute({ enabled: auth.password, required: auth.password }),
        authenticator_app: attribute(),
        ticket: attribute({ enabled: true, used_for_first_factor: true, first_factors: ['ticket'] }),
        backup_code: attribute(),
        passkey: attribute(),
      },
      social: Object.fromEntries(Object.keys(auth.social).filter((strategy) => PROVIDERS[strategy]).map((strategy) => [strategy, {
        enabled: true, required: false, authenticatable: true, block_email_subaddresses: false, strategy, not_selectable: false, deprecated: false,
        name: PROVIDERS[strategy]!.name, logo_url: `https://img.clerk.com/static/${strategy.replace(/^oauth_/, '')}.png`,
      }])),
      saml: { enabled: false },
      enterprise_sso: { enabled: false },
      sign_in: { second_factor: { required: false } },
      sign_up: { captcha_enabled: false, captcha_widget_type: 'smart', custom_action_required: false, progressive: true, mode: 'public', legal_consent_enabled: auth.legalConsent },
      restrictions: {
        allowlist: { enabled: false }, blocklist: { enabled: false }, allowlist_blocklist_disabled_on_sign_in: { enabled: false },
        block_email_subaddresses: { enabled: false }, block_disposable_email_domains: { enabled: false },
      },
      password_settings: {
        disable_hibp: true, disable_password_reverification: true, min_length: PASSWORD_MIN_LENGTH, max_length: 72, require_special_char: false,
        require_numbers: false, require_uppercase: false, require_lowercase: false, show_zxcvbn: false, min_zxcvbn_strength: 0,
        enforce_hibp_on_sign_in: false, allowed_special_characters: '',
      },
      username_settings: { min_length: null, max_length: null, allow_extended_special_characters: false, allow_numeric_usernames: false },
      actions: { delete_self: false, create_organization: true, create_organizations_limit: null },
      attack_protection: { user_lockout: { enabled: false }, pii: { enabled: false }, email_link: { require_same_client: false }, enumeration_protection: { enabled: false } },
      passkey_settings: { allow_autofill: false, show_sign_in_button: false, satisfies_second_factor: false },
    },
    organization_settings: {
      // "Organizations are disabled by default" (https://clerk.com/docs/guides/organizations/configure)
      enabled: org.enabled === true,
      max_allowed_memberships: typeof org.max_allowed_memberships === 'number' ? org.max_allowed_memberships : 5,
      // the membership model: "Membership required" is what clerk-js reads as forcing a person to choose an organization
      force_organization_selection: org.enabled === true && auth.membershipRequired,
      actions: { admin_delete: org.admin_delete_enabled !== false },
      domains: { enabled: domains.enabled === true, enrollment_modes: Array.isArray(domains.enrollment_modes) ? domains.enrollment_modes : [], default_role: typeof domains.default_role === 'string' ? domains.default_role : 'org:member' },
      // whether a person names an organization's slug (spec:/components/schemas/OrganizationSettings.SlugSettings; off on a
      // new application, the Backend API's settings)
      slug: { disabled: org.slug_disabled === true },
      creator_role: typeof org.creator_role === 'string' ? org.creator_role : 'org:admin',
    },
    fraud_settings: { object: 'fraud_settings', native: { device_attestation_mode: 'disabled' } },
    commerce_settings: { billing: { stripe_publishable_key: null, user: { enabled: false, has_paid_plans: false }, organization: { enabled: false, has_paid_plans: false } } },
    api_keys_settings: { enabled: false, user_api_keys_enabled: false, orgs_api_keys_enabled: false },
    maintenance_mode: false,
  };
}

/** `GET /v1/environment`: "The environment contains information about the settings and features enabled for the current
 *  instance." */
export async function getEnvironment(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(environmentDoc(ctx, await rootOf(ctx)));
}

/** `PATCH /v1/environment`: clerk-js reports its origin here in development; the environment answered is unchanged
 *  (nothing the call sends is a setting the twin models). */
export async function updateEnvironment(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(environmentDoc(ctx, await rootOf(ctx)));
}
