// The api lane's state rulings (architecture, "State"): the read API moves nothing; its items and users are written by
// the site lane (../../../site/src/semantics/). An item's `type` is what it is from the moment it is made (a story, a
// comment), never a state it moves through.
export const states = {
  Item: {
    notState: [
      // what the item is: a story or comment from its making (spec:/components/schemas/Item/properties/type)
      'type',
    ],
  },
};
