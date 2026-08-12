// Simple in-memory mock for MongoDB collection
class MockCollection {
  constructor() {
    this.store = new Map();
  }
  async insertOne(doc) {
    const id = doc._id || (Math.random().toString(36).slice(2));
    const newDoc = { ...doc, _id: id };
    this.store.set(id, newDoc);
    return { insertedId: id };
  }
  async findOne(filter) {
    for (const doc of this.store.values()) {
      let match = true;
      for (const key of Object.keys(filter)) {
        if (doc[key] !== filter[key]) { match = false; break; }
      }
      if (match) return doc;
    }
    return null;
  }
  async findOneAndUpdate(filter, update, options) {
    const doc = await this.findOne(filter);
    if (doc) {
      const updated = { ...doc, ...update.$set, ...update.$setOnInsert };
      this.store.set(doc._id, updated);
      return { value: updated };
    } else if (options.upsert) {
      const newDoc = { ...filter, ...update.$setOnInsert, ...update.$set };
      const id = newDoc._id || (Math.random().toString(36).slice(2));
      newDoc._id = id;
      this.store.set(id, newDoc);
      return { value: newDoc };
    }
    return { value: null };
  }
  async updateOne(filter, update) {
    const doc = await this.findOne(filter);
    if (doc) {
      const updated = { ...doc, ...update.$set };
      this.store.set(doc._id, updated);
    }
  }
  async deleteMany(filter) {
    for (const [id, doc] of this.store.entries()) {
      let match = true;
      for (const key of Object.keys(filter)) {
        const val = filter[key];
        if (typeof val === 'object' && val.$in) {
          if (!val.$in.includes(doc[key])) { match = false; break; }
        } else if (doc[key] !== val) { match = false; break; }
      }
      if (match) this.store.delete(id);
    }
  }
  async deleteOne(filter) {
    for (const [id, doc] of this.store.entries()) {
      let match = true;
      for (const key of Object.keys(filter)) {
        if (doc[key] !== filter[key]) { match = false; break; }
      }
      if (match) { this.store.delete(id); break; }
    }
  }
  async countDocuments(filter = {}) {
    let count = 0;
    for (const doc of this.store.values()) {
      let match = true;
      for (const key of Object.keys(filter)) {
        if (doc[key] !== filter[key]) { match = false; break; }
      }
      if (match) count++;
    }
    return count;
  }
  async find(filter = {}) {
    const results = [];
    for (const doc of this.store.values()) {
      let match = true;
      for (const key of Object.keys(filter)) {
        if (doc[key] !== filter[key]) { match = false; break; }
      }
      if (match) results.push(doc);
    }
    return {
      toArray: async () => results,
      forEach: async (cb) => { for (const d of results) await cb(d); }
    };
  }
}
module.exports = { MockCollection };
