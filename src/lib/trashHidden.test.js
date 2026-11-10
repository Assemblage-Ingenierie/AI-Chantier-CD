import { describe, it, expect, beforeEach } from 'vitest';
import { getHiddenTrashKeys, hideTrashKeys } from './trashHidden.js';

beforeEach(() => localStorage.clear());

describe('corbeille — éléments masqués', () => {
  it('masque par projet, sans doublon', () => {
    hideTrashKeys('P1', ['h|1', 'l|a']);
    hideTrashKeys('P1', ['h|1', 'p|x']);
    hideTrashKeys('P2', ['h|9']);
    expect([...getHiddenTrashKeys('P1')]).toEqual(['h|1', 'l|a', 'p|x']);
    expect([...getHiddenTrashKeys('P2')]).toEqual(['h|9']);
    expect(getHiddenTrashKeys('P3').size).toBe(0);
  });
  it('stockage illisible → rien de masqué (jamais de crash)', () => {
    localStorage.setItem('chantierai_trash_hidden', '{oops');
    expect(getHiddenTrashKeys('P1').size).toBe(0);
    expect(hideTrashKeys('P1', ['k']).has('k')).toBe(true);
  });
});
