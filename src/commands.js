const id = {
  name: 'id',
  description: 'The feature number',
  type: 'integer',
  required: true,
};

const everyone = {
  group: 'feature',
  groupDescription: 'Bid on the features people want built',
};

const admin = subcommand => ({
  group: 'feature-admin',
  groupDescription: 'Add and manage the features people bid on',
  subcommand,
  discord: { dmPermission: false, defaultMemberPermissions: '32' },
});

const definitions = {
  'feature-list': {
    ...everyone,
    description: 'List the features people are bidding on',
    args: [
      {
        name: 'private',
        description: 'Only show the list to you',
        type: 'boolean',
      },
      {
        name: 'status',
        description: 'open or done, open by default',
        type: 'string',
      },
    ],
  },
  'feature-show': {
    ...everyone,
    description: 'Show a feature and who is backing it',
    args: [id],
  },
  'feature-bid': {
    ...everyone,
    description: 'Put FMC behind a feature',
    private: true,
    args: [
      id,
      {
        name: 'amount',
        description: 'How much FMC to bid',
        type: 'integer',
        required: true,
      },
      {
        name: 'hidden',
        description: 'Keep your name and amount off the list',
        type: 'boolean',
      },
    ],
  },
  'feature-mine': {
    ...everyone,
    description: 'Show your own bids',
    private: true,
  },
  'feature-add': {
    ...admin('add'),
    description: 'Add a feature for people to bid on',
    args: [
      {
        name: 'title',
        description: 'What the feature is',
        type: 'string',
        required: true,
      },
      {
        name: 'description',
        description: 'A little more about it',
        type: 'string',
      },
    ],
  },
  'feature-edit': {
    ...admin('edit'),
    description: "Change a feature's title or description",
    private: true,
    args: [
      id,
      {
        name: 'title',
        description: 'The new title',
        type: 'string',
      },
      {
        name: 'description',
        description: 'The new description, or - to remove it',
        type: 'string',
      },
    ],
  },
  'feature-goal': {
    ...admin('goal'),
    description: 'Set how much FMC a feature is aiming for',
    private: true,
    args: [
      id,
      {
        name: 'amount',
        description: 'The goal in FMC, or 0 to remove it',
        type: 'integer',
        required: true,
      },
    ],
  },
  'feature-due': {
    ...admin('due'),
    description: 'Set the date a feature is due, as YYYY-MM-DD',
    private: true,
    args: [
      id,
      {
        name: 'date',
        description: 'The due date as YYYY-MM-DD, or - to remove it',
        type: 'string',
        required: true,
      },
    ],
  },
  'feature-repeat': {
    ...admin('repeat'),
    description: 'Move the due date forward by this much on each cash-out',
    private: true,
    args: [
      id,
      {
        name: 'count',
        description: 'How many days, months or years, or 0 to stop repeating',
        type: 'integer',
        required: true,
        minValue: 0,
        maxValue: 1000,
      },
      {
        name: 'unit',
        description: 'days, months or years',
        type: 'string',
        choices: [
          { name: 'days', value: 'days' },
          { name: 'months', value: 'months' },
          { name: 'years', value: 'years' },
        ],
      },
    ],
  },
  'feature-reset': {
    ...admin('reset'),
    description: 'Cash out bids and start the feature over',
    args: [
      id,
      {
        name: 'amount',
        description: 'How much FMC to cash out, everything by default',
        type: 'integer',
      },
    ],
  },
  'feature-done': {
    ...admin('done'),
    description: 'Mark a feature as built and close its bidding',
    args: [id],
  },
  'feature-remove': {
    ...admin('remove'),
    description: 'Remove a feature and refund its bids',
    private: true,
    args: [id],
  },
  'feature-sync': {
    ...admin('sync'),
    description: 'Post or refresh every feature on the board channel',
    private: true,
  },
};

module.exports = { definitions };
