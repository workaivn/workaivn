export class ProviderAdapter {
  constructor({
    id,
    name,
    type = 'cloud',
    capabilities = {},
    healthCheck = null,
    generate = null
  } = {}) {
    this.id = id || 'unknown';
    this.name = name || this.id;
    this.type = type;
    this.capabilities = capabilities || {};
    this._healthCheck = healthCheck;
    this._generate = generate;
  }

  async healthCheck() {
    if (typeof this._healthCheck === 'function') {
      return this._healthCheck();
    }
    return { healthy: true, provider: this.id, model: null, reason: null };
  }

  async generate(request = {}) {
    if (typeof this._generate !== 'function') {
      throw new Error(`Provider adapter ${this.id} does not implement generate()`);
    }
    return this._generate(request);
  }
}

export function createProviderAdapter(definition = {}) {
  return new ProviderAdapter(definition);
}
