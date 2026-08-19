// Tests drive real git, and git reads the developer's own configuration. A machine
// carrying, say, `url.git@github.com:.insteadOf https://github.com/` makes
// `git remote get-url` hand back a rewritten URL — which failed a registration test on
// one machine and passed everywhere else. Point git at no configuration at all so the
// suite sees the same git on every machine and in CI.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
