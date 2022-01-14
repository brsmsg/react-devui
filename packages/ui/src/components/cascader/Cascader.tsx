import type { Updater } from '../../hooks/two-way-binding';
import type { DSelectBoxProps } from '../_select-box';
import type { Draft } from 'immer';

import { isArray, isNull, isNumber, isString, isUndefined } from 'lodash';
import React, { useCallback, useRef, useEffect, useMemo, useState, useId } from 'react';
import { flushSync } from 'react-dom';
import { filter } from 'rxjs';

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
import { DPopup } from '../_popup';
import { DSelectBox } from '../_select-box';
import { DVirtualScroll } from '../_virtual-scroll';
import { DDropdown, DDropdownItem } from '../dropdown';
import { DIcon } from '../icon';
import { DTag } from '../tag';

const IS_GROUP = Symbol();
const IS_EMPTY = Symbol();
const IS_CREATE = Symbol();

export interface DCascaderContextData<T> {
  cascaderUniqueId: string;
  cascaderVisible: boolean;
  cascaderSelecteds: T[] | T[][];
  cascaderMultiple: boolean;
  cascaderOnlyLeafSelectable: boolean;
  cascaderFocusIds: string[];
  cascaderOptionRender: NonNullable<DCascaderBaseProps<T>['dOptionRender']>;
  cascaderGetId: NonNullable<DCascaderBaseProps<T>['dGetId']>;
  cascaderPreventClose: () => void;
  onFocusIdsChange: (updater: (ids: string[]) => void) => void;
}
export const DCascaderContext = React.createContext<DCascaderContextData<unknown> | null>(null);

export interface DCascaderOption<T> {
  dLabel: string;
  dValue: T;
  dDisabled?: boolean;
  dLoading?: boolean;
  dChildren?: Array<DCascaderOption<T>>;
  [index: string | symbol]: unknown;
}

export interface DCascaderBaseProps<T> extends Omit<DSelectBoxProps, 'dSuffix' | 'dExpanded' | 'dShowClear'> {
  dFormControlName?: string;
  dVisible?: [boolean, Updater<boolean>?];
  dOptions: Array<DCascaderOption<T>>;
  dOptionRender?: (option: DCascaderOption<T>, index: number) => React.ReactNode;
  dGetId?: (value: T) => string;
  dClearable?: boolean;
  dOnlyLeafSelectable?: boolean;
  dCustomSearch?: {
    filter?: (value: string, options: Array<DCascaderOption<T>>) => boolean;
    sort?: (a: Array<DCascaderOption<T>>, b: Array<DCascaderOption<T>>) => number;
  };
  dPopupClassName?: string;
  onVisibleChange?: (visible: boolean) => void;
}

export interface DCascaderSingleProps<T> extends DCascaderBaseProps<T> {
  dModel?: [T[], Updater<T[]>?];
  dMultiple?: false;
  dCustomSelected?: (selects: Array<DCascaderOption<T>>) => string;
  onModelChange?: (selects: T[]) => void;
}

export interface DCascaderMultipleProps<T> extends DCascaderBaseProps<T> {
  dModel?: [T[][], Updater<T[][]>?];
  dMultiple: true;
  dCustomSelected?: (selects: Array<Array<DCascaderOption<T>>>) => string[];
  onModelChange?: (selects: T[][]) => void;
}

const DEFAULT_PROPS = {
  dOptionRender: (option: DCascaderOption<unknown>) => option.dLabel,
  dGetId: (value: unknown) => String(value),
};
export function DCascader<T>(props: DCascaderSingleProps<T>): React.ReactElement;
export function DCascader<T>(props: DCascaderMultipleProps<T>): React.ReactElement;
export function DCascader<T>(
  props: DCascaderBaseProps<T> & {
    dModel?: [T[] | T[][], Updater<T[] | T[][]>?];
    dMultiple?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dCustomSelected?: (select: any) => string | string[];
    onModelChange?: (selects: T[] | T[][]) => void;
  }
) {
  const {
    dModel,
    dFormControlName,
    dVisible,
    dOptions,
    dOptionRender = DEFAULT_PROPS.dOptionRender,
    dCustomSelected,
    dGetId = DEFAULT_PROPS.dGetId,
    dOnlyLeafSelectable = true,
    dClearable = false,
    dCustomSearch,
    dLoading = false,
    dMultiple = false,
    dDisabled = false,
    dPopupClassName,
    dSize,
    onVisibleChange,
    onModelChange,
    onSearch,
    id,
    className,
    children,
    onChange,
    onClick,
    onKeyDown,
    ...restProps
  } = useComponentConfig(DCascader.name, props);

  //#region Context
  const dPrefix = usePrefixConfig();
  const { gSize, gDisabled } = useGeneralState();
  //#endregion

  //#region Ref
  const cascaderBoxRef = useRef<HTMLDivElement>(null);
  const [cascaderListEl, cascaderListRef] = useRefCallback<HTMLUListElement>();
  //#endregion

  const dataRef = useRef<{
    beforeSearch: { scrollTop: number; focusId: string | null } | null;
    clearTid: (() => void) | null;
    focusId: string | null;
  }>({
    beforeSearch: null,
    clearTid: null,
    focusId: null,
  });

  const [t] = useTranslation('Common');
  const asyncCapture = useAsync();

  const uniqueId = useId();
  const _id = id ?? `${dPrefix}cascader-${uniqueId}`;

  const [focusId, setfocusId] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState('');

  const [visible, changeVisible] = useTwoWayBinding(false, dVisible, onVisibleChange);
  const [cascader, changeCascader, { validateClassName, ariaAttribute, controlDisabled }] = useTwoWayBinding(
    dMultiple ? [] : null,
    dModel,
    onModelChange,
    dFormControlName ? { formControlName: dFormControlName, id: _id } : undefined
  );

  const size = dSize ?? gSize;
  const disabled = dDisabled || gDisabled || controlDisabled;

  const hasSearchChar = searchValue.length > 0;

  const [renderOptions, flatOptions, flatAllOptions] = useMemo(() => {
    const defaultFilterFn = (value: string, option: DCascaderOption<T>) => {
      return option.dLabel.includes(value);
    };
    const filterFn = isUndefined(dCustomSearch) ? defaultFilterFn : dCustomSearch.filter ?? defaultFilterFn;

    let createOption = hasSearchChar ? onCreateOption?.(searchValue) ?? null : null;
    if (createOption) {
      createOption = {
        ...createOption,
        [IS_CREATE]: true,
      };
    }

    const flatAllOptions: Array<DCascaderBaseOption<T>> = [];
    let flatOptions: Array<DCascaderOption<T>> = [];
    let renderOptions: Array<DCascaderOption<T>> = [];

    (createOptions as Array<DCascaderOption<T>>).concat(dOptions).forEach((item: DCascaderOption<T>) => {
      if (isUndefined(item.dOptions)) {
        if (createOption && dGetId(item.dValue as T) === dGetId(createOption.dValue)) {
          createOption = null;
        }
        flatAllOptions.push(item as DCascaderBaseOption<T>);
        if (!hasSearchChar || filterFn(searchValue, item as DCascaderBaseOption<T>)) {
          flatOptions.push(item);
          renderOptions.push(item);
        }
      } else {
        const groupOptions: Array<DCascaderBaseOption<T>> = [];
        item.dOptions.forEach((groupItem) => {
          if (createOption && dGetId(groupItem.dValue) === dGetId(createOption.dValue)) {
            createOption = null;
          }
          flatAllOptions.push(groupItem);
          if (!hasSearchChar || filterFn(searchValue, groupItem)) {
            groupOptions.push(groupItem);
          }
        });

        if (!hasSearchChar) {
          flatOptions.push({
            [IS_GROUP]: true,
            dLabel: item.dLabel,
          });

          if (groupOptions.length === 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            groupOptions.push({ [IS_EMPTY]: item.dLabel } as any);
          }
          renderOptions.push({
            [IS_GROUP]: true,
            dLabel: item.dLabel,
            dOptions: groupOptions,
          });
        } else {
          renderOptions = renderOptions.concat(groupOptions);
        }
        flatOptions = flatOptions.concat(groupOptions);
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortFn = dCustomSearch?.sort as any;
    if (sortFn && hasSearchChar) {
      renderOptions.sort(sortFn);
      flatOptions.sort(sortFn);
    }

    if (createOption) {
      flatAllOptions.unshift(createOption);
      flatOptions.unshift(createOption);
      renderOptions.unshift(createOption);
    }

    return [renderOptions, flatOptions, flatAllOptions];
  }, [createOptions, dCustomSearch, dGetId, dOptions, hasSearchChar, onCreateOption, searchValue]);

  const canCascader = useCallback((option) => !option.dDisabled && !option[IS_EMPTY] && !option[IS_GROUP], []);
  const canCascaderItem = useCallback(
    (id?: string) => {
      let count = -1;
      let option: DCascaderBaseOption<T> | null = null;
      for (const item of flatOptions) {
        count += 1;

        if (canCascader(item)) {
          if (id) {
            if (id === dGetId(item.dValue as T)) {
              option = item as DCascaderBaseOption<T>;
              break;
            }
          } else {
            option = item as DCascaderBaseOption<T>;
            break;
          }
        }
      }
      return [count, option] as [number, DCascaderBaseOption<T> | null];
    },
    [canCascader, dGetId, flatOptions]
  );

  const handleOptionClick = useCallback(
    (e: { currentTarget?: HTMLElement; __dSwitch?: boolean }) => {
      dataRef.current.clearTid && dataRef.current.clearTid();

      const optionId = isUndefined(e.currentTarget) ? dataRef.current.focusId : (e.currentTarget.dataset['dOptionId'] as string);
      dataRef.current.focusId = optionId;
      setfocusId(optionId);
      const option = flatAllOptions.find((option) => !option.dDisabled && dGetId(option.dValue) === optionId);

      if (option) {
        const createOption = () => {
          if (option[IS_CREATE]) {
            setCreateOptions((draft) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              draft.unshift({ ...option, [IS_CREATE]: false } as any);
            });
          }
        };
        if (dMultiple) {
          const __dSwitch = e.__dSwitch ?? true;

          changeCascader((draft) => {
            if (isArray(draft)) {
              const index = draft.findIndex((item) => dGetId(item as T) === optionId);
              if (index !== -1) {
                __dSwitch && draft.splice(index, 1);
              } else {
                if (isNumber(dMaxCascaderNum) && draft.length === dMaxCascaderNum) {
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
          changeCascader(option.dValue);
        }
      }

      if (!dMultiple) {
        changeVisible(false);
        asyncCapture.setTimeout(() => {
          if (cascaderBoxRef.current) {
            cascaderBoxRef.current.focus({ preventScroll: true });
          }
        });
      }
    },
    [asyncCapture, changeCascader, changeVisible, dGetId, dMaxCascaderNum, dMultiple, flatAllOptions, onExceed, setCreateOptions]
  );

  const handleClick = useCallback(
    (e) => {
      onClick?.(e);

      dataRef.current.clearTid && dataRef.current.clearTid();
      changeVisible(!visible);
    },
    [changeVisible, onClick, visible]
  );

  const handleKeyDown = useCallback<React.KeyboardEventHandler<HTMLDivElement>>(
    (e) => {
      onKeyDown?.(e);

      if (e.code === 'Space' || e.code === 'Enter') {
        if (!visible) {
          e.preventDefault();
          e.stopPropagation();
          changeVisible(true);
        }
      }
    },
    [changeVisible, onKeyDown, visible]
  );

  const handleClear = useCallback(() => {
    if (visible) {
      dataRef.current.clearTid && dataRef.current.clearTid();
      changeVisible(true);
    }

    if (dMultiple) {
      changeCascader([]);
    } else {
      changeCascader(null);
    }
  }, [visible, dMultiple, changeVisible, changeCascader]);

  const handleSearch = useCallback(
    (value: string) => {
      onSearch?.(value);
      setSearchValue(value);
      if (value.length > 0 && cascaderListEl) {
        if (isNull(dataRef.current.beforeSearch)) {
          dataRef.current.beforeSearch = {
            focusId: dataRef.current.focusId,
            scrollTop: cascaderListEl.scrollTop,
          };
        }
      }
    },
    [onSearch, cascaderListEl]
  );
  useEffect(() => {
    if (searchValue.length > 0 && cascaderListEl) {
      cascaderListEl.scrollTop = 0;
      const [, option] = canCascaderItem();
      if (option) {
        dataRef.current.focusId = dGetId(option.dValue);
        setfocusId(dataRef.current.focusId);
      }
    } else {
      if (dataRef.current.beforeSearch && cascaderListEl) {
        dataRef.current.focusId = dataRef.current.beforeSearch.focusId;
        const scrollTop = dataRef.current.beforeSearch.scrollTop;
        const loop = () => {
          cascaderListEl.scrollTop = scrollTop;
          if (cascaderListEl.scrollTop !== scrollTop) {
            asyncCapture.setTimeout(() => loop());
          }
        };
        loop();
        setfocusId(dataRef.current.focusId);
        dataRef.current.beforeSearch = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  const customTransition = useCallback((popupEl: HTMLElement, targetEl: HTMLElement) => {
    const { top, left, transformOrigin } = getVerticalSideStyle(popupEl, targetEl, 'bottom-left', 8);
    popupEl.style.width = Math.min(window.innerWidth - 20, targetEl.getBoundingClientRect().width) + 'px';
    return {
      top,
      left,
      stateList: {
        'enter-from': { transform: 'scaleY(0.7)', opacity: '0' },
        'enter-to': { transition: 'transform 116ms ease-out, opacity 116ms ease-out', transformOrigin },
        'leave-active': { transition: 'transform 116ms ease-in, opacity 116ms ease-in', transformOrigin },
        'leave-to': { transform: 'scaleY(0.7)', opacity: '0' },
      },
    };
  }, []);

  const handleRendered = useCallback(() => {
    if (cascaderListEl) {
      if (isNull(dataRef.current.focusId)) {
        if (isNull(cascader) || (isArray(cascader) && cascader.length === 0)) {
          const [, option] = canCascaderItem();
          if (option) {
            dataRef.current.focusId = dGetId(option.dValue);
          }
        } else {
          dataRef.current.focusId = isArray(cascader) ? dGetId(cascader[0]) : dGetId(cascader);
          const [count] = canCascaderItem(dataRef.current.focusId);
          cascaderListEl.scrollTop = count * 32;
        }
        setfocusId(dataRef.current.focusId);
      }
    }
  }, [canCascaderItem, dGetId, cascader, cascaderListEl]);

  useEffect(() => {
    const [asyncGroup, asyncId] = asyncCapture.createGroup();

    if (visible) {
      asyncGroup.fromEvent(window, 'click', { capture: true }).subscribe({
        next: () => {
          dataRef.current.clearTid = asyncCapture.setTimeout(() => {
            flushSync(() => changeVisible(false));
          }, 20);
        },
      });
    }

    return () => {
      asyncCapture.deleteGroup(asyncId);
    };
  }, [asyncCapture, changeVisible, visible]);

  useEffect(() => {
    const [asyncGroup, asyncId] = asyncCapture.createGroup();

    if (visible) {
      asyncGroup
        .fromEvent<KeyboardEvent>(window, 'keydown')
        .pipe(filter((e) => e.code === 'Escape'))
        .subscribe({
          next: () => {
            flushSync(() => changeVisible(false));
            asyncGroup.setTimeout(() => {
              if (cascaderBoxRef.current) {
                cascaderBoxRef.current.focus({ preventScroll: true });
              }
            });
          },
        });
    }

    return () => {
      asyncCapture.deleteGroup(asyncId);
    };
  }, [asyncCapture, changeVisible, visible]);

  const [cascaderedNode, suffixNode] = useMemo(() => {
    let cascaderedNode: React.ReactNode = null;
    let suffixNode: React.ReactNode = null;
    if (dMultiple) {
      if (isArray(cascader)) {
        const optionsCascadered: Array<DCascaderBaseOption<T>> = [];
        let tags: Array<{ label: string; id: string }> = [];
        const cascaderIds = cascader.map((item) => dGetId(item));
        flatAllOptions.forEach((item) => {
          if (!item.dDisabled) {
            const id = dGetId(item.dValue);
            if (cascaderIds.includes(id)) {
              optionsCascadered.push(item);
              tags.push({ label: item.dLabel, id });
            }
          }
        });
        if (dCustomCascadered) {
          tags = (dCustomCascadered(optionsCascadered) as string[]).map((item, index) => ({ label: item, id: tags[index].id }));
        }

        suffixNode = (
          <DDropdown
            dTriggerNode={
              <DTag
                className={`${dPrefix}cascader__multiple-count`}
                dSize={size}
                dTheme={isNumber(dMaxCascaderNum) && dMaxCascaderNum === cascader.length ? 'danger' : undefined}
              >
                {(cascader as T[]).length} ...
              </DTag>
            }
            dCloseOnItemClick={false}
          >
            {tags.map((item) => (
              <DDropdownItem
                key={item.id}
                dId={item.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) {
                    dataRef.current.focusId = item.id;
                    handleOptionClick({});
                  }
                }}
              >
                {item.label}
              </DDropdownItem>
            ))}
          </DDropdown>
        );
        cascaderedNode = tags.map((item) => (
          <DTag
            key={item.id}
            dSize={size}
            dClosable
            onClose={(e) => {
              e.stopPropagation();
              if (!disabled) {
                dataRef.current.focusId = item.id;
                handleOptionClick({});
              }
            }}
          >
            {item.label}
          </DTag>
        ));
      }
    } else {
      if (!isNull(cascader)) {
        const id = dGetId(cascader as T);
        for (const option of flatAllOptions) {
          if (!option.dDisabled && dGetId(option.dValue) === id) {
            if (dCustomCascadered) {
              cascaderedNode = dCustomCascadered(option);
            } else {
              cascaderedNode = option.dLabel;
            }
            break;
          }
        }
      }
    }
    return [cascaderedNode, suffixNode];
  }, [dCustomCascadered, dGetId, dMaxCascaderNum, dMultiple, dPrefix, disabled, flatAllOptions, handleOptionClick, cascader, size]);

  const hasCascader = isArray(cascader) ? cascader.length > 0 : !isNull(cascader);

  const handleUlClick = useCallback(() => {
    dataRef.current.clearTid && dataRef.current.clearTid();
  }, []);

  const itemRender = useCallback(
    (item, index, renderProps) => {
      if (item[IS_EMPTY]) {
        return (
          <li key={`${dPrefix}cascader-${uniqueId}-empty-${item[IS_EMPTY]}`} className={`${dPrefix}cascader__option-empty`}>
            <span className={`${dPrefix}cascader__option-content`}>{t('No Data')}</span>
          </li>
        );
      }
      if (item.dOptions) {
        return (
          <ul
            key={`${dPrefix}cascader-${uniqueId}-group-${item.dLabel}`}
            className={getClassName(`${dPrefix}cascader__option-group`)}
            role="group"
            aria-labelledby={`${dPrefix}cascader-${uniqueId}-group-${item.dLabel}`}
          >
            <li
              key={`${dPrefix}cascader-${uniqueId}-group-${item.dLabel}`}
              id={`${dPrefix}cascader-${uniqueId}-group-${item.dLabel}`}
              role="presentation"
            >
              <span className={`${dPrefix}cascader__option-content`}>{item.dLabel}</span>
            </li>
            {renderProps.children}
          </ul>
        );
      }

      const _item = item as DCascaderBaseOption<T>;
      const optionId = dGetId(_item.dValue);

      let isCascadered = false;
      if (isArray(cascader)) {
        isCascadered = cascader.findIndex((item) => dGetId(item) === optionId) !== -1;
      } else if (isNull(cascader)) {
        isCascadered = false;
      } else {
        isCascadered = dGetId(cascader) === optionId;
      }

      return (
        <li
          {...renderProps}
          key={optionId}
          id={`${dPrefix}cascader-${uniqueId}-option-${optionId}`}
          className={getClassName(`${dPrefix}cascader__option`, {
            'is-cascadered': isCascadered,
            'is-focus': focusId === optionId,
            'is-disabled': _item.dDisabled,
          })}
          tabIndex={-1}
          role="option"
          title={_item.dLabel}
          aria-cascadered={isCascadered}
          aria-disabled={_item.dDisabled}
          data-d-option-id={optionId}
          onClick={_item.dDisabled ? undefined : handleOptionClick}
        >
          {_item[IS_CREATE] && (
            <span className={`${dPrefix}cascader__option-add`}>
              <DIcon viewBox="64 64 896 896" dTheme="primary">
                <path d="M482 152h60q8 0 8 8v704q0 8-8 8h-60q-8 0-8-8V160q0-8 8-8z"></path>
                <path d="M176 474h672q8 0 8 8v60q0 8-8 8H176q-8 0-8-8v-60q0-8 8-8z"></path>
              </DIcon>
            </span>
          )}
          <span className={`${dPrefix}cascader__option-content`}>{dOptionRender(_item, index)}</span>
        </li>
      );
    },
    [dGetId, dOptionRender, dPrefix, focusId, handleOptionClick, cascader, t, uniqueId]
  );

  return (
    <DPopup
      className={getClassName(dPopupClassName, `${dPrefix}cascader-popup`)}
      dVisible={visible}
      dPopupContent={
        flatOptions.length === 0 && !dLoading ? (
          <span className={`${dPrefix}cascader__empty`}>{t('No Data')}</span>
        ) : (
          <>
            {dLoading && (
              <span
                className={getClassName(`${dPrefix}cascader__loading`, {
                  [`${dPrefix}cascader__loading--left`]: flatOptions.length === 0,
                })}
              >
                <DIcon viewBox="0 0 1024 1024" dSize={flatOptions.length === 0 ? 18 : 24} dSpin>
                  <path d="M988 548c-19.9 0-36-16.1-36-36 0-59.4-11.6-117-34.6-171.3a440.45 440.45 0 00-94.3-139.9 437.71 437.71 0 00-139.9-94.3C629 83.6 571.4 72 512 72c-19.9 0-36-16.1-36-36s16.1-36 36-36c69.1 0 136.2 13.5 199.3 40.3C772.3 66 827 103 874 150c47 47 83.9 101.8 109.7 162.7 26.7 63.1 40.2 130.2 40.2 199.3.1 19.9-16 36-35.9 36z"></path>
                </DIcon>
              </span>
            )}
            <DVirtualScroll
              id={`${dPrefix}cascader-${uniqueId}`}
              className={`${dPrefix}cascader__list`}
              tabIndex={-1}
              role="listbox"
              aria-multicascaderable={dMultiple}
              aria-activedescendant={isString(focusId) ? `${dPrefix}cascader-${uniqueId}-option-${focusId}` : undefined}
              dListRef={cascaderListRef}
              dList={renderOptions}
              dItemRender={itemRender}
              dNestedKey="dOptions"
              dSize={264}
              dItemSize={32}
              onScrollEnd={onScrollBottom}
              onClick={handleUlClick}
            />
          </>
        )
      }
      dTrigger={null}
      dArrow={false}
      dCustomPopup={customTransition}
      dTriggerRender={(renderProps) => (
        <DCascaderBox
          {...restProps}
          {...renderProps}
          ref={cascaderBoxRef}
          id={_id}
          className={getClassName(className, `${dPrefix}cascader`, validateClassName, {
            [`${dPrefix}cascader--multiple`]: dMultiple,
          })}
          dSuffix={suffixNode}
          dExpanded={visible}
          dShowClear={dClearable && hasCascader}
          dLoading={dLoading}
          dDisabled={disabled}
          dSize={size}
          dAriaAttribute={ariaAttribute}
          onClear={handleClear}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onSearch={handleSearch}
        >
          {hasCascader && cascaderedNode}
        </DCascaderBox>
      )}
      onRendered={handleRendered}
    />
  );
}
