import { isUndefined } from 'lodash';

export interface TreeOption<T> {
  dLabel: string;
  dValue: T;
  dDisabled?: boolean;
  dChildren?: Array<TreeOption<T>>;
  [index: string | symbol]: unknown;
}

export type TreeNodeStatus = 'INDETERMINATE' | 'CHECKED' | 'UNCHECKED';

const [INDETERMINATE, CHECKED, UNCHECKED] = ['INDETERMINATE', 'CHECKED', 'UNCHECKED'] as TreeNodeStatus[];

export class TreeNode<T> {
  private _parent: TreeNode<T> | null = null;
  private _disabled: boolean;
  private _multiple: boolean;
  private _onlyLeafSelectable: boolean;
  private _children: Array<TreeNode<T>> | null = null;
  private _status: TreeNodeStatus = UNCHECKED;

  constructor(public node: TreeOption<T>, private selecteds: T[] | T[][], opts?: { multiple?: boolean; onlyLeafSelectable?: boolean }) {
    this._multiple = opts?.multiple ?? false;
    this._onlyLeafSelectable = opts?.onlyLeafSelectable ?? true;
    this._setUpChildren();
    this.updateStatus(true);
  }

  get parent(): TreeNode<T> | null {
    return this._parent;
  }
  get root(): TreeNode<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: TreeNode<T> = this;

    while (node.parent) {
      node = node.parent;
    }

    return node;
  }

  get children(): Array<TreeNode<T>> | null {
    return this._children;
  }

  get isLeaf(): boolean {
    return !this._children;
  }

  get status(): TreeNodeStatus {
    return this._status;
  }

  get checked(): boolean {
    return this._status === CHECKED;
  }
  get unchecked(): boolean {
    return this._status === UNCHECKED;
  }
  get indeterminate(): boolean {
    return this._status === INDETERMINATE;
  }

  get disabled(): boolean {
    return this._disabled;
  }
  get enabled(): boolean {
    return !this._disabled;
  }

  setParent(parent: TreeNode<T>): void {
    this._parent = parent;
  }

  changeStatus(onlySelf = false, status?: TreeNodeStatus) {
    if (this.enabled) {
      const update = () => {
        this._updateAncestors(onlySelf);
        this._forEachChild((node) => {
          node.changeStatus(true, this._status);
        });
      };

      if (isUndefined(status)) {
        this._status = this.checked ? UNCHECKED : CHECKED;
        update();
      } else if (this._status !== status) {
        this._status = status;
        update();
      }
    }
  }

  updateStatus(onlySelf = false): void {
    if (this.enabled) {
      this._status = this._calculateStatus();

      if (this._parent && !onlySelf) {
        this._parent.updateStatus(onlySelf);
      }
    }
  }

  private _updateAncestors(onlySelf: boolean) {
    if (this._parent && !onlySelf) {
      this._parent.updateStatus(onlySelf);
    }
  }

  private _calculateStatus(): TreeNodeStatus {
    if (this.disabled) return this._status;
    if (this.isLeaf) return this._status;
    const children = this.children as Array<TreeNode<T>>;
    if (this._multiple) {
      let checked = 0;
      let hasIndeterminate = false;
      for (const node of children) {
        if (node.indeterminate) {
          hasIndeterminate = true;
          break;
        } else if (node.checked) {
          checked += 1;
        }
      }
      if (hasIndeterminate) {
        return INDETERMINATE;
      } else {
        return checked === 0 ? UNCHECKED : CHECKED;
      }
    } else {
      return this._anyNodes(children, (node) => node.checked) ? CHECKED : UNCHECKED;
    }
  }

  private _forEachChild(cb: (v: TreeNode<T>, i: number) => void): void {
    if (this.children) {
      this.children.forEach((v, i) => {
        cb(v, i);
      });
    }
  }

  private _anyNodes(children: Array<TreeNode<T>>, condition: (n: TreeNode<T>) => boolean): boolean {
    for (const node of children) {
      if (condition(node)) {
        return true;
      }
    }

    return false;
  }

  private _setUpChildren(): void {
    if (this.node.dChildren) {
      this._children = this.node.dChildren.map((v) => {
        const node = new TreeNode(v, this.selecteds, { multiple: this._multiple, onlyLeafSelectable: this._onlyLeafSelectable });
        node.setParent(this);
        return node;
      });
    }
  }
}
