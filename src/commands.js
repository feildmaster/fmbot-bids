const id = {
  name: 'id',
  description: 'The feature number',
  type: 'integer',
  required: true,
};

const adminOnly = { dmPermission: false, defaultMemberPermissions: '32' };

const definitions = {
  'feature-list': {
    description: 'List the features people are bidding on',
    args: [{
      name: 'status',
      description: 'open or done, open by default',
      type: 'string',
    }],
  },
  'feature-show': {
    description: 'Show a feature and who is backing it',
    args: [id],
  },
  'feature-bid': {
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
    description: 'Show your own bids',
    private: true,
  },
  'feature-add': {
    description: 'Add a feature for people to bid on',
    args: [{
      name: 'title',
      description: 'What the feature is',
      type: 'string',
      required: true,
    }],
    discord: adminOnly,
  },
  'feature-done': {
    description: 'Mark a feature as built and close its bidding',
    args: [id],
    discord: adminOnly,
  },
  'feature-remove': {
    description: 'Remove a feature nobody has bid on',
    private: true,
    args: [id],
    discord: adminOnly,
  },
};

module.exports = { definitions };
