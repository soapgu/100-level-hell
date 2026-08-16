export type InputDirection = "left" | "right";

export class DirectionInputController {
  private keyboard: Record<InputDirection, boolean> = { left: false, right: false };
  private pointers: Record<InputDirection, Set<number>> = { left: new Set(), right: new Set() };
  private pressed: Record<InputDirection, boolean> = { left: false, right: false };
  private onChange: (direction: InputDirection, pressed: boolean) => void;

  constructor(onChange: (direction: InputDirection, pressed: boolean) => void = () => {}) {
    this.onChange = onChange;
  }

  setOnChange(onChange: (direction: InputDirection, pressed: boolean) => void) {
    this.onChange = onChange;
  }

  setKeyboard(direction: InputDirection, pressed: boolean) {
    this.keyboard[direction] = pressed;
    this.sync(direction);
  }

  addPointer(direction: InputDirection, pointerId: number) {
    this.pointers[direction].add(pointerId);
    this.sync(direction);
  }

  removePointer(direction: InputDirection, pointerId: number) {
    this.pointers[direction].delete(pointerId);
    this.sync(direction);
  }

  releaseAll() {
    this.keyboard = { left: false, right: false };
    this.pointers.left.clear();
    this.pointers.right.clear();
    this.sync("left");
    this.sync("right");
  }

  isPressed(direction: InputDirection) {
    return this.pressed[direction];
  }

  private sync(direction: InputDirection) {
    const next = this.keyboard[direction] || this.pointers[direction].size > 0;
    if (next === this.pressed[direction]) return;
    this.pressed[direction] = next;
    this.onChange(direction, next);
  }
}
