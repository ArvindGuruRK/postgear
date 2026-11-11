/**
 * How long `findBy...` and `waitFor` keep looking. Testing Library's own
 * second is enough for a test run alone and too little beside the whole
 * suite, where a page-level render has been seen to take longer. A passing
 * test is no slower for this: the wait ends the moment the thing is there.
 */
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5_000 });
