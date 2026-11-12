// twenty-icons's state rulings (architecture, "State"). A stored favicon has no lifecycle: the vendor stores a domain's
// sizes once, on its first request, and serves them thereafter.
export const states = {};
export const notState = { _icon: ['domain', 'size', 'declaredAt'] };
