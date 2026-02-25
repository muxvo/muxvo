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
  /** Match navigation: current match (1-based) */
  matchCurrent?: number;
  /** Match navigation: total matches */
  matchTotal?: number;
  onPrevMatch?: () => void;
  onNextMatch?: () => void;
}

export function SearchInput({ value, onChange, placeholder = 'Search...', matchCurrent, matchTotal, onPrevMatch, onNextMatch }: SearchInputProps) {
  const showNav = value && matchTotal != null && matchTotal > 0;
  return (
    <div className="search-input-wrap">
      <input
        type="text"
        className="search-input-wrap__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={showNav ? { paddingRight: 110 } : undefined}
      />
      {showNav && (
        <div className="search-input-wrap__nav">
          <span className="search-input-wrap__nav-count">{matchCurrent}/{matchTotal}</span>
          <button className="search-input-wrap__nav-btn" onClick={onPrevMatch} disabled={matchCurrent != null && matchCurrent <= 1}>&#9650;</button>
          <button className="search-input-wrap__nav-btn" onClick={onNextMatch} disabled={matchCurrent != null && matchCurrent >= (matchTotal ?? 0)}>&#9660;</button>
        </div>
      )}
      {value && !showNav && (
        <button
          className="search-input-wrap__clear"
          onClick={() => onChange('')}
        >
          &times;
        </button>
      )}
      {showNav && (
        <button
          className="search-input-wrap__clear search-input-wrap__clear--with-nav"
          onClick={() => onChange('')}
        >
          &times;
        </button>
      )}
    </div>
  );
}
