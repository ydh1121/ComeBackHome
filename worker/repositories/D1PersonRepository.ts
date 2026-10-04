import type { PersonRepository } from '../../src/application/contracts/repositories';
import type { EntityId } from '../../src/domain/common';
import type { Person } from '../../src/domain/models';
import type { D1DatabaseLike } from '../runtime-types';
import { utcNow } from './d1-helpers';

interface PersonRow {
  id: string;
  name: string;
  relation: string;
}

function toPerson(row: PersonRow): Person {
  return { id: row.id, name: row.name, relation: row.relation };
}

export class D1PersonRepository implements PersonRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async list(): Promise<Person[]> {
    const result = await this.db.prepare(
      'SELECT id, name, relation FROM people ORDER BY created_at ASC, id ASC',
    ).all<PersonRow>();
    return result.results.map(toPerson);
  }

  async get(id: EntityId): Promise<Person | null> {
    const row = await this.db.prepare(
      'SELECT id, name, relation FROM people WHERE id = ?1 LIMIT 1',
    ).bind(id).first<PersonRow>();
    return row ? toPerson(row) : null;
  }

  async create(input: Omit<Person, 'id'>): Promise<Person> {
    const person: Person = { id: crypto.randomUUID(), ...input };
    const now = utcNow();
    await this.db.prepare(
      'INSERT INTO people (id, name, relation, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)',
    ).bind(person.id, person.name, person.relation, now).run();
    return person;
  }

  async update(id: EntityId, patch: Partial<Omit<Person, 'id'>>): Promise<Person> {
    const current = await this.get(id);
    if (!current) throw new Error('Person was not found.');

    const updated: Person = {
      ...current,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.relation === undefined ? {} : { relation: patch.relation }),
    };

    await this.db.prepare(
      'UPDATE people SET name = ?2, relation = ?3, updated_at = ?4 WHERE id = ?1',
    ).bind(id, updated.name, updated.relation, utcNow()).run();

    return updated;
  }
}
