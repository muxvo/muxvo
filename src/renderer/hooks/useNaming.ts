/**
 * useNaming — Hook for terminal tile naming machine state management.
 * Wraps createNamingMachine and provides React state + event handlers.
 */

import { useState, useRef, useEffect } from 'react';
import { createNamingMachine } from '@/shared/machines/terminal-naming';

export interface UseNamingResult {
  namingState: string;
  namingContext: { displayText: string; editValue: string };
  inputValue: string;
  setInputValue: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  sendNaming: (event: string | { type: string; value?: string }) => void;
  handlePlaceholderClick: (e: React.MouseEvent) => void;
  handleNameClick: (e: React.MouseEvent) => void;
  handleInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleInputBlur: () => void;
}

export function useNaming(
  id: string,
  customName: string | undefined,
  onRename: ((id: string, name: string) => void) | undefined,
): UseNamingResult {
  const namingRef = useRef(createNamingMachine(customName));
  const [namingState, setNamingState] = useState(namingRef.current.state);
  const [namingContext, setNamingContext] = useState(namingRef.current.context);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  function sendNaming(event: string | { type: string; value?: string }) {
    namingRef.current.send(event);
    setNamingState(namingRef.current.state);
    setNamingContext(namingRef.current.context);
    // Report name changes to parent
    if (namingRef.current.state === 'DisplayNamed') {
      onRename?.(id, namingRef.current.context.displayText);
    } else if (namingRef.current.state === 'DisplayEmpty') {
      onRename?.(id, '');
    }
  }

  // Initialize input value when entering Editing state
  useEffect(() => {
    if (namingState === 'Editing') {
      setInputValue(namingContext.editValue);
    }
  }, [namingState, namingContext.editValue]);

  // Disable menu bar drag region during editing so blur fires on click
  useEffect(() => {
    if (namingState === 'Editing') {
      document.body.classList.add('name-editing');
    } else {
      document.body.classList.remove('name-editing');
    }
    return () => document.body.classList.remove('name-editing');
  }, [namingState]);

  const handlePlaceholderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendNaming('CLICK_PLACEHOLDER');
  };

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendNaming('CLICK_NAME');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendNaming({ type: 'ENTER', value: inputValue });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      sendNaming('ESC');
    }
  };

  const handleInputBlur = () => {
    sendNaming({ type: 'BLUR', value: inputValue });
  };

  return {
    namingState,
    namingContext,
    inputValue,
    setInputValue,
    inputRef,
    sendNaming,
    handlePlaceholderClick,
    handleNameClick,
    handleInputKeyDown,
    handleInputBlur,
  };
}
