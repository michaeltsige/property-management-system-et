/** Conventional Commits - https://www.conventionalcommits.org */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'web',
        'api',
        'shared',
        'i18n',
        'calendar',
        'db',
        'jobs',
        'docs',
        'ci',
        'repo',
        'payments',
        'notifications',
      ],
    ],
    'subject-case': [2, 'always', ['sentence-case', 'lower-case']],
    'header-max-length': [2, 'always', 100],
  },
};
