/**
 * Shared SearchInput — reusable search box with clear button.
 * Used by SkillList, SessionList, etc.
 */

import React from 'react';
import './SearchInput.css';

/** Escape special regex characters */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlight matching query text with <mark> */
export function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="search-highlight">{part}</mark>
          : part
      )}
    </>
  );
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Result count for simple mode (no nav) */
  resultCount?: number;
  /** Match navigation: current match (1-based) */
  matchCurrent?: number;
  /** Match navigation: total matches */
  matchTotal?: number;
  onPrevMatch?: () => void;
  onNextMatch?: () => void;
}

export function SearchInput({ value, onChange, placeholder = 'Search...', resultCount, matchCurrent, matchTotal, onPrevMatch, onNextMatch }: SearchInputProps) {
  const hasQuery = Boolean(value?.trim());
  const showResultCount = hasQuery && resultCount != null && resultCount >= 0 && matchTotal == null;
  const showNav = hasQuery && matchTotal != null;
  return (
    <div className="search-input-wrap">
      <input
        type="text"
        className="search-input-wrap__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={showResultCount || showNav ? { paddingRight: 110 } : undefined}
      />
      {showResultCount && (
        <span className="search-input-wrap__result-count">{resultCount} 个结果</span>
      )}
      {showNav && (
        <div className="search-input-wrap__nav">
          <span className="search-input-wrap__nav-count">{matchCurrent}/{matchTotal}</span>
          <button className="search-input-wrap__nav-btn" onClick={onPrevMatch} disabled={!matchTotal || (matchCurrent != null && matchCurrent <= 1)}>&#9650;</button>
          <button className="search-input-wrap__nav-btn" onClick={onNextMatch} disabled={!matchTotal || (matchCurrent != null && matchCurrent >= (matchTotal ?? 0))}>&#9660;</button>
        </div>
      )}
      {value && !showResultCount && !showNav && (
        <button
          className="search-input-wrap__clear"
          onClick={() => onChange('')}
        >
          &times;
        </button>
      )}
      {(showResultCount || showNav) && (
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
