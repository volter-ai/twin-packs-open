# File-selected read-only profiles

ClickHouse release source `834cccbc6e8c7f0db21ec500394c3a567b83482f`
defines the empty default and readonly profiles in
[users.xml](https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/programs/server/users.xml).
The same file associates a user with a profile and defines `::/0` as access from
everywhere. That unrestricted network needs no peer-address substitution.
Restricted IP sets and hostname rules require their actual peer mechanism and
remain unsupported inputs.

[Settings.cpp:2443-2445](https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Core/Settings.cpp)
defines readonly values 0, 1 and 2; the setting has UInt64 type and also accepts
larger values. All modes are retained, including exact decimal
UInt64 values beyond JavaScript's safe integer range. Values above zero refuse
the modeled persistent mutations. The client cannot change readonly once it is
above zero; an unchanged value is retained.

[SettingsConstraints.cpp:257-259 and 437-441](https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Access/SettingsConstraints.cpp)
skips unchanged settings and refuses changes to other settings in readonly mode 1
unless their constraints explicitly permit them. Mode 1 checks each client setting
before execution. A changed setting with a modeled default returns code 164 naming
that setting; an unchanged value is skipped after its vendor type conversion.
Source profiles with additional fields, inheritance or changeable constraints
remain input gaps.

The generated initializer reading `recordings/readonly-setting-defaults-24.12.json`
pins Settings.cpp, Defines.h, SettingsFields.cpp and SettingsConstraints.cpp. It
retains every reached COMMON_SETTINGS identity/type/initializer. Literal booleans,
strings, float values, signed/unsigned integers and confined constant arithmetic
have comparisons; automatic defaults, build-condition-dependent constants,
unresolved expressions/types, aliases,
format-factory settings and unsupported input forms are named comparison gaps.
They are never inferred from another setting. Numeric comparisons retain integer
precision; float comparisons use their vendor field width. This is partial settings
comparison coverage, rather than a general settings engine. In particular,
Defines.h:124-128 selects a one-second QUERY_PROFILER_DEFAULT_SAMPLE_RATE_NS in
release builds and zero under SANITIZER. Both query-profiler period comparisons
remain gaps until the selected build condition is known.

[HTTPHandler.cpp:405-433 and 795-809](https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Server/HTTPHandler.cpp)
defines reserved URL names, query text and `param_` substitutions outside settings.
Other URL values reach the same gate as native setting entries, including native
entries without the important flag. Mode 0 validates a batch before applying it.
In every mode that permits setting changes, a changed non-readonly setting
returns a named application gap before query execution; the twin serves no
general settings application engine. Unchanged values use the same retained
vendor default comparison. An important native flag does not turn a known
unchanged setting into an unknown one. Unmodeled identities, aliases, conversions
and build-dependent defaults remain named comparison gaps, including native
entries without the important flag; this does not claim the vendor's optional
unknown-setting ignore path. SQL SET
and SELECT SETTINGS remain unsupported statements, not a second settings path.

[setReadOnlyIfHTTPMethodIdempotent.cpp:17-27](https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Server/HTTP/setReadOnlyIfHTTPMethodIdempotent.cpp)
raises a zero policy to 2 for non-POST requests and keeps an already stricter
policy. [HTTPHandler.cpp:400, then 447-448](https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Server/HTTPHandler.cpp)
sets the method restriction before checking and applying URL settings.
Native clients pass the actual setting value into the same query handler;
an absent setting differs from an explicit zero. The policy is checked before
formatting or query execution and cannot be overwritten by operator configuration.
An operator cannot add an actor absent from the original users file to escape
that file's policy; issued credentials must belong to a source user. Verified
startup marks installation with a process-local kernel capability and stores its
source user/policy anchor in the same configuration record. Later configuration
door calls cannot replace that anchor, remove users, add users, change credentials
or weaken policies. Calls omitting users/policies retain the source maps. The
anchor survives resume, and a changed source user domain requires a fresh World.

Configuration parsing does not claim quota accounting, management privileges,
restricted networks or general settings-profile inheritance. Those directives
keep the original-input plan incomplete. Logging and other server directives are
independent inputs and remain explicit gaps.
