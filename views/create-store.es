import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk'
import { observer, observe } from 'redux-observers'
import { get, set, debounce } from 'lodash'
import { remote } from 'electron'

import { middleware as promiseActionMiddleware } from './middlewares/promise-action'
import { reducerFactory, onConfigChange } from './redux'
import { saveQuestTracking, schedualDailyRefresh } from './redux/info/quests'
import { dispatchBattleResult } from './redux/battle'

const cachePosition = '_storeCache'
const targetPaths = ['const', 'info']
const storeCache = (function() {
  try {
    return JSON.parse(localStorage.getItem(cachePosition) || '{}')
  } catch (e) {
    return {}
  }
})()

//### Utils ###

const setLocalStorage = () => {
  if (!window.isMain) {
    return
  }
  process.nextTick(() => {
    localStorage.setItem(cachePosition, JSON.stringify(storeCache))
  })
}

const setLocalStorageDebounced = debounce(setLocalStorage, 5000)

function autoCacheObserver(store, path) {
  return observer(
    (state) => get(state, path),
    (dispatch, current, previous) => {
      set(storeCache, path, current)
      setLocalStorageDebounced()
    }
  )
}


//### Executing code ###

export const store = createStore(
  reducerFactory(),
  storeCache,
  applyMiddleware(
    promiseActionMiddleware,
    thunk
  ),
  window.devToolsExtension && window.dbg.isEnabled() ? window.devToolsExtension() : f => f
)
window.dispatch = store.dispatch

//### Listeners and exports ###

window.getStore = (path) => {
  return path ? get(store.getState(), path) : store.getState()
}

// Listen to config.set event
const solveConfSet = (path, value) => {
  const details = {
    path: path,
    value: value,
  }
  store.dispatch(onConfigChange(details))
}
const config = remote.require('./lib/config')
config.addListener('config.set', solveConfSet)
remote.getCurrentWindow().on('close', (e) => {
  config.removeListener('config.set', solveConfSet)
})

// When any targetPath is modified, store it into localStorage
observe(store,
  targetPaths.map((path) => autoCacheObserver(store, path))
)

// Save quest tracking to the file when it changes
observe(store, [observer(
  (state) => state.info.quests.records,
  (dispatch, current, previous) => saveQuestTracking(current)
)])

schedualDailyRefresh(store.dispatch)

// Dispatch an action '@@BattleResult' when a battle is completed
observe(store, [observer(
  (state) => state.battle.result,
  dispatchBattleResult,
)])

let _reducerExtensions = {}

// Use this function to extend extra reducers to the store, such as plugin
// specific data maintainance.
// Use extensionSelectorFactory(key) inside utils/selectors to access it.
export function extendReducer(key, reducer) {
  const _reducerExtensionsNew = {
    ..._reducerExtensions,
    [key]: reducer,
  }
  try {
    store.replaceReducer(reducerFactory(_reducerExtensionsNew))
    _reducerExtensions = _reducerExtensionsNew
  } catch (e) {
    console.warn(`Reducer extension ${key} is not a valid reducer`, e.stack)
  }
}

window.config.get = (path, value) => {
  return get(window.getStore('config'), path, value)
}
