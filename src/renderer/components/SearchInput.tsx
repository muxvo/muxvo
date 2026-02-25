/**
 * Shared SearchInput — reusable search box with clear button.
 * Used by SkillList, SessionList, etc.
 */

import React from 'react';
import './SearchInput.css';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search...' }: SearchInputProps) {
  return (
    <div className="search-input-wrap">
      <input
        type="text"
        className="search-input-wrap__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className="search-input-wrap__clear"
          onClick={() => onChange('')}
        >
          &times;
        </button>
      )}
    </div>
  );
}
