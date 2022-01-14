import type { DCascaderBaseProps, DCascaderOption } from './Cascader';

import { isNull, isString, isUndefined } from 'lodash';
import React, { useCallback, useRef, useEffect, useMemo, useState, useId, useContext } from 'react';

import {
  usePrefixConfig,
  useComponentConfig,
  useTwoWayBinding,
  useAsync,
  useImmer,
  useTranslation,
  useRefCallback,
  useGeneralState,
} from '../../hooks';
import { getClassName, getVerticalSideStyle } from '../../utils';
import { DVirtualScroll } from '../_virtual-scroll';
import { DCascaderContext } from './Cascader';

export interface DListProps<T> {
  dParents?: Array<DCascaderOption<T>>;
  dList: Array<DCascaderOption<T>>;
  onModelChange?: (selects: T | T[]) => void;
}

export function DList<T>(props: DListProps<T>) {
  const { dParents, dList } = props;

  //#region Context
  const dPrefix = usePrefixConfig();
  const {
    cascaderUniqueId,
    cascaderVisible,
    cascaderSelecteds,
    cascaderMultiple,
    cascaderOnlyLeafSelectable,
    cascaderFocusIds,
    cascaderOptionRender,
    cascaderGetId,
    cascaderPreventClose,
    onFocusIdsChange,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  } = useContext(DCascaderContext)!;
  //#endregion

  //#region Ref
  const [listEl, listRef] = useRefCallback<HTMLUListElement>();
  //#endregion

  const asyncCapture = useAsync();

  const selectedIds = useMemo(() => {
    const parentsIds = (dParents ?? []).map((item) => cascaderGetId(item.dValue));
    if (cascaderMultiple) {
      const selecteds = cascaderSelecteds as unknown[][];
      const selectedIds: string[] = [];
      for (const values of selecteds) {
        const valuesIds = values.map((item) => cascaderGetId(item));
        if (valuesIds.length !== 0) {
          if (valuesIds.length <= parentsIds.length) {
            let matchAll = true;
            for (const [index, valuesId] of valuesIds.entries()) {
              if (parentsIds[index] !== valuesId) {
                matchAll = false;
                break;
              }
            }
            if (matchAll) {
              return true;
            }
          } else if (valuesIds.length === parentsIds.length + 1) {
            let matchAll = true;
            for (const [index, parentsId] of parentsIds.entries()) {
              if (valuesIds[index] !== parentsId) {
                matchAll = false;
                break;
              }
            }
            if (matchAll) {
              selectedIds.push(valuesIds[valuesIds.length - 1]);
            }
          }
        }
      }
      return selectedIds;
    } else {
      const selecteds = cascaderSelecteds as unknown[];
      const valuesIds = selecteds.map((item) => cascaderGetId(item));
      if (valuesIds.length === parentsIds.length + 1) {
        let matchAll = true;
        for (const [index, parentsId] of parentsIds.entries()) {
          if (valuesIds[index] !== parentsId) {
            matchAll = false;
            break;
          }
        }
        if (matchAll) {
          return valuesIds[valuesIds.length - 1];
        }
      }
    }
  }, [cascaderGetId, cascaderMultiple, cascaderSelecteds, dParents]);

  const canSelect = useCallback((option) => !option.dDisabled, []);
  const canSelectItem = useCallback(
    (id?: string) => {
      let count = -1;
      let option: DCascaderOption<T> | null = null;
      for (const item of dList) {
        count += 1;

        if (canSelect(item)) {
          if (id) {
            if (id === cascaderGetId(item.dValue)) {
              option = item;
              break;
            }
          } else {
            option = item;
            break;
          }
        }
      }
      return [count, option] as [number, DCascaderOption<T> | null];
    },
    [canSelect, cascaderGetId, dList]
  );

  const focusId = useMemo(() => {
    const lastFocusId = cascaderFocusIds[cascaderFocusIds.length - 1];
    if (lastFocusId) {
      const option = dList.find((item) => cascaderGetId(item.dValue) === lastFocusId);
      if (option) {
        return cascaderGetId(option.dValue);
      }
    }

    return null;
  }, [cascaderFocusIds, cascaderGetId, dList]);

  const handleOptionClick = useCallback(
    (optionId: string, isSwitch?: boolean) => {
      const option = dList.find((option) => !option.dDisabled && cascaderGetId(option.dValue) === optionId);

      if (option) {
        if (cascaderMultiple) {
          isSwitch = isSwitch ?? true;

          changeSelect((draft) => {
            if (isArray(draft)) {
              const index = draft.findIndex((item) => dGetId(item as T) === optionId);
              if (index !== -1) {
                isSwitch && draft.splice(index, 1);
              } else {
                if (isNumber(dMaxSelectNum) && draft.length === dMaxSelectNum) {
                  onExceed?.();
                } else {
                  createOption();
                  draft.push(option.dValue as Draft<T>);
                }
              }
            } else {
              throw new Error("Please pass Array when `dMultiple` is 'true'");
            }
          });
        } else {
          createOption();
          changeSelect(option.dValue);
        }
      }

      if (!dMultiple) {
        changeVisible(false);
        asyncCapture.setTimeout(() => {
          if (selectBoxRef.current) {
            selectBoxRef.current.focus({ preventScroll: true });
          }
        });
      }
    },
    [asyncCapture, changeSelect, changeVisible, dGetId, dMaxSelectNum, dMultiple, flatAllOptions, onExceed, setCreateOptions]
  );

  useEffect(() => {
    const [asyncGroup, asyncId] = asyncCapture.createGroup();

    if (listEl && cascaderVisible && !isNull(focusId)) {
      const changeFocusByKeydown = (down = true) => {
        let [count] = canSelectItem(focusId);
        let option: DCascaderOption<T> | undefined;
        const getOption = () => {
          if (!down && count === 0) {
            listEl.scrollTop = 0;
            return;
          }
          if (down && count === dList.length - 1) {
            listEl.scrollTop = listEl.scrollHeight;
            return;
          }
          count = down ? count + 1 : count - 1;
          let _option: DCascaderOption<T> | null = dList[count];
          _option = _option && canSelect(_option) ? _option : null;
          if (_option) {
            option = _option;
          } else {
            getOption();
          }
        };
        getOption();
        if (option && !isUndefined(option.dValue)) {
          const elTop = [count * 32 + 4, (count + 1) * 32 + 4];
          if (listEl.scrollTop > elTop[1]) {
            listEl.scrollTop = elTop[0] - 4;
          } else if (elTop[0] > listEl.scrollTop + listEl.clientHeight) {
            listEl.scrollTop = elTop[1] - listEl.clientHeight + 4;
          } else {
            if (down) {
              if (elTop[1] > listEl.scrollTop + listEl.clientHeight) {
                listEl.scrollTop = elTop[1] - listEl.clientHeight + 4;
              }
            } else {
              if (listEl.scrollTop > elTop[0]) {
                listEl.scrollTop = elTop[0] - 4;
              }
            }
          }

          const id = cascaderGetId(option.dValue);
          onFocusIdsChange((draft) => {
            draft.splice(draft.length - 1, 1, id);
          });
        }
      };

      asyncGroup.fromEvent<KeyboardEvent>(window, 'keydown').subscribe({
        next: (e) => {
          switch (e.code) {
            case 'ArrowDown':
              e.preventDefault();
              changeFocusByKeydown();
              break;

            case 'ArrowUp':
              e.preventDefault();
              changeFocusByKeydown(false);
              break;

            case 'Home':
              e.preventDefault();

              listEl.scrollTop = 0;
              for (const item of dList) {
                if (canSelect(item)) {
                  const id = cascaderGetId(item.dValue);
                  onFocusIdsChange((draft) => {
                    draft.splice(draft.length - 1, 1, id);
                  });
                  break;
                }
              }
              break;

            case 'End':
              e.preventDefault();

              listEl.scrollTop = listEl.scrollHeight;
              for (let index = dList.length - 1; index >= 0; index--) {
                if (canSelect(dList[index])) {
                  const id = cascaderGetId(dList[index].dValue);
                  onFocusIdsChange((draft) => {
                    draft.splice(draft.length - 1, 1, id);
                  });
                  break;
                }
              }
              break;

            case 'Enter':
              e.preventDefault();
              handleOptionClick({ __dSwitch: false });
              break;

            case 'Space':
              if (dMultiple) {
                e.preventDefault();
                handleOptionClick({ __dSwitch: true });
              }
              break;

            default:
              break;
          }
        },
      });
    }

    return () => {
      asyncCapture.deleteGroup(asyncId);
    };
  }, [asyncCapture, canCascader, canCascaderItem, dGetId, dMultiple, flatOptions, handleOptionClick, cascaderListEl, setfocusId, visible]);

  const itemRender = useCallback(
    (item: DCascaderOption<T>, index, renderProps) => {
      const optionId = cascaderGetId(item.dValue);
      let isSelected = false;
      if (isUndefined(selectedIds)) {
        isSelected = false;
      } else if (selectedIds === true) {
        isSelected = true;
      } else if (isString(selectedIds)) {
        isSelected = optionId === selectedIds;
      } else {
        isSelected = selectedIds.includes(optionId);
      }

      return (
        <li
          {...renderProps}
          key={optionId}
          id={`${dPrefix}cascader-${cascaderUniqueId}-option-${optionId}`}
          className={getClassName(`${dPrefix}cascader__option`, {
            'is-selected': isSelected,
            'is-disabled': item.dDisabled,
          })}
          tabIndex={-1}
          role="option"
          title={item.dLabel}
          aria-selected={isSelected}
          aria-disabled={item.dDisabled}
          onClick={
            item.dDisabled
              ? undefined
              : () => {
                  onSelectedsChange((dParents ?? []).concat(item), isUndefined(item.dChildren));
                }
          }
        >
          <span className={`${dPrefix}cascader__option-content`}>{cascaderOptionRender(item, index)}</span>
        </li>
      );
    },
    [cascaderGetId, cascaderOptionRender, cascaderSelecteds, cascaderUniqueId, dParents, dPrefix, onSelectedsChange]
  );

  return (
    <DVirtualScroll
      className={`${dPrefix}cascader__list`}
      tabIndex={-1}
      role="listbox"
      aria-multiselectable={cascaderMultiple}
      aria-activedescendant={isString(focusId) ? `${dPrefix}cascader-${cascaderUniqueId}-option-${focusId}` : undefined}
      dListRef={listRef}
      dList={dList}
      dItemRender={itemRender}
      dSize={264}
      dItemSize={32}
    ></DVirtualScroll>
  );
}
