import { writable, get, derived } from 'svelte/store'
import persist, { deferred, debounced } from 'svelte-persist'

const USERNAME = 'user'
const error = e => console.error(e)
const headers = {
  'Content-Type': 'application/json'
}

class API {
  constructor (config, alert) {
    this.host = (config.host || location.hostname) + ':'
    this.host += config.port || location.port
    this.alert = alert || console.log

    this.listen()

    const { subscribe, set, update } = writable(false)
    this.busy = { subscribe }
    this.take = (timeout = 30000) =>
      set(
        setTimeout(() => {
          set(false)
          this.alert('Time out')
        }, timeout)
      )
    this.release = () =>
      update(timer => {
        clearTimeout(timer)
        return false
      })
  }
  listen () {
    const { set, subscribe } = debounced('frLastUpdate', '')
    this.last = { subscribe }
    this.query = persist('frUpdateQuery', {})

    new EventSource(
      `//events.${this.host}/${USERNAME}/${get(this.last)}`
    ).onmessage = e => {
      this.query.update(query => {
        if (!query) return query
        const data = JSON.parse(e.data)
        query[data.branch] = [...(query[data.branch] || []), data]
        set(e.lastEventId)
        return { ...query }
      })
    }
  }
  db (name, indexed = false, validate = () => true) {
    return new DB({
      ...this,
      name,
      indexed,
      validate
    })
  }
}

class DB {
  constructor () {
    this.init(arguments[0])
    this.listen()
  }
  init (args) {
    for (const key in args) {
      this[key] = args[key]
    }
    if (!Array.isArray(this.indexed)) {
      this.localStore()
    }
    const { subscribe } = derived(
      [this.busy, this.store],
      ([busy, store]) => ({ busy, store })
    )
    this.subscribe = subscribe
  }
  localStore () {
    const { subscribe, update } = deferred(this.name, [])
    const get = (id, store) => store.findIndex(item => item.id === id)
    this.store = {
      subscribe,
      post: async item =>
        (await update(items => [...items, item])) || item.id,
      put: async item =>
        (await update(items => {
          const i = get(item.id, items)
          if (~i) items[i] = item
          else items.splice(0, 0, item)
          return [...items]
        })) || item.id,
      delete: async id =>
        (await update(items => {
          const i = get(id, items)
          if (~i) items.splice(i, 1)
          return [...items]
        })) || id
    }
  }
  listen () {
    this.last.subscribe(() => {
      this.query.update(async query => {
        if (!query) return query
        const q = query[this.name]
        if (!q || !q.length) return query
        this.take()
        const result = await Promise.all(
          q.map(e => this.fetch(e))
        ).catch(error)
        this.release()
        query[this.name] = q.filter(item => item.id in result)
        return { ...query }
      })
    })
  }
  fetch (event) {
    if (event.action === 'delete') {
      return this.store.delete(event.id)
    }
    return fetch(`//rest.${this.host}/${this.name}/${event.id}`)
      .catch(error)
      .then(res =>
        res.status === 200
          ? res
            .json()
            .catch(error)
            .then(item => this.store[event.action](item))
          : null
      )
  }
  pust (item, put = false) {
    if (!this.validate(item)) return this.alert('lol')
    return fetch(`//rest.${this.host}/${this.name}`, {
      method: put ? 'PUT' : 'POST',
      headers: headers,
      body: JSON.stringify(item)
    })
  }
  async post (item) {
    const res = await this.pust(item)
    const message = await res.json()
    this.alert(message)
  }
  //   this.synced = persist(name + 'LastChange', {
  //     current: 0,
  //     archive: 0
  //   })
  //   this.synced.subscribe(value => {
  //     this.syncedTime = value
  //   })
  //   this.sorting = persist(name + 'Sort', {
  //     col: 'created',
  //     asc: true
  //   })
  //   this.filters = persist(name + 'Filters', {})
  //   this.page = writable(0)
  //   this.archive = persist(name + 'Archive', {
  //     active: false,
  //     from: now() - 2592000000,
  //     to: now()
  //   })
  //   this.archive.subscribe(value => {
  //     this.isArchive = value.active
  //     this.archiveRange = {
  //       from: value.from,
  //       to: value.to
  //     }
  //   })
  //   this.store = writable([])
  //   this.store.subscribe(store => {
  //     this.storeCount = store.length
  //     if (!store.length) this.prevPage()
  //   })
  //   this.state = derived(
  //     [this.sorting, this.filters, this.page, this.archive, this.synced],
  //     ([sort, filters, page, archive]) => ({ sort, filters, page, archive })
  //   )
  //   const idb = indexedDB.open(name, 1)
  //   idb.onsuccess = e => {
  //     this.idb = e.target.result
  //     this.fire = fire.collection(name)
  //     this.fireArchive = fire.collection(name + 'Archive')
  //     this.fire
  //       .orderBy('updated', 'desc')
  //       .where('updated', '>=', this.syncedTime.current)
  //       .onSnapshot(
  //         {
  //           includeMetadataChanges: true
  //         },
  //         query => {
  //           this.updateIDB(query)
  //         }
  //       )
  //     this.archiveListen()
  //     this.state.subscribe(state => this.setStore(state))
  //   }
  //   idb.onupgradeneeded = e => {
  //     const store = e.target.result.createObjectStore(name)
  //     const storeArchive = e.target.result.createObjectStore(name + 'Archive')
  //     indexed.concat('id', 'created').forEach(index => {
  //       store.createIndex(index, index)
  //       storeArchive.createIndex(index, index)
  //     })
  //   }
  // }
  // remote () {
  //   return this.isArchive ? this.fireArchive : this.fire
  // }
  // async get (id) {
  //   if (!id) return
  //   return new Promise((resolve, reject) => {
  //     const get = this.idb
  //       .transaction(this.name)
  //       .objectStore(this.name)
  //       .get(id)
  //     get.onsuccess = e =>
  //       e.target.result ? resolve(e.target.result) : reject(Error(id))
  //     get.onerror = () => reject(Error(id))
  //   })
  // }
  // async exists (id) {
  //   if (!id) return this.alert(this.name + ' not exists.')
  //   const doc = await this.remote()
  //     .doc(id)
  //     .get()
  //   return doc.exists
  // }
  // async put (record) {
  //   if (!this.validate(record)) return
  //   this.take()
  //   record.updated = timestamp
  //   return this.remote()
  //     .doc(record.id)
  //     .set(record)
  // }
  // async patch (id, obj = {}) {
  //   this.take()
  //   obj.updated = timestamp
  //   return this.remote()
  //     .doc(id)
  //     .set(obj, { merge: true })
  // }
  // async post (record) {
  //   if (!this.validate(record)) return
  //   this.take()
  //   const newRecord = this.remote().doc()
  //   record.id = newRecord.id
  //   record.created = now()
  //   record.updated = timestamp
  //   await newRecord.set(record)
  //   return record
  // }
  // async del (id) {
  //   this.take()
  //   return this.remote()
  //     .doc(id)
  //     .delete()
  // }
  // async toArchive (record) {
  //   this.take()
  //   await this.fire.doc(record.id).delete()
  //   record.archive = true
  //   record.updated = timestamp
  //   this.fireArchive.doc(record.id).set(record)
  // }
  // sort (sortCol) {
  //   const newSort = { asc: true }
  //   this.sorting.update(sort => {
  //     if (sort.col === sortCol || !sortCol) {
  //       newSort.asc = !sort.asc
  //     }
  //     newSort.col = sortCol || sort.col
  //     return newSort
  //   })
  // }
  // filter (col, value) {
  //   if (!col) return
  //   this.filters.update(filters => {
  //     filters[col] = value
  //     if (!value) delete filters[col]
  //     return { ...filters }
  //   })
  // }
  // nextPage () {
  //   this.page.update(page => (this.storeCount === PER_PAGE ? page + 1 : page))
  // }
  // prevPage () {
  //   this.page.update(page => (page > 0 ? page - 1 : page))
  // }
  // async archiveSet ({ active, from, to }) {
  //   this.archive.update(archive => ({
  //     active: active === undefined ? archive.active : active,
  //     from: from || archive.from,
  //     to: to || archive.to
  //   }))
  //   if (from || to) {
  //     this.archiveListener()
  //     await this.archiveClear()
  //     this.archiveListen()
  //   }
  // }
  // }

  // DB.prototype.setStore = function (state) {
  //   if (!this.idb || !state) return
  //   const result = []
  //   const dir = !state.sort.asc ? 'next' : 'prev'
  //   const filters = state.filters
  //   const name = this.name + (state.archive.active ? 'Archive' : '')
  //   let skip = state.page * PER_PAGE
  //   this.idb
  //     .transaction(name)
  //     .objectStore(name)
  //     .index(state.sort.col)
  //     .openCursor(null, dir).onsuccess = e => {
  //       const cursor = e.target.result
  //       if (cursor && result.length < PER_PAGE) {
  //         const val = cursor.value
  //         if (
  //           Object.keys(filters).every(
  //             col =>
  //               val[col] &&
  //             !!~val[col].toLowerCase().indexOf(filters[col].toLowerCase())
  //           )
  //         ) {
  //           if (skip) skip--
  //           else result.push(cursor.value)
  //         }
  //         cursor.continue()
  //       } else {
  //         this.store.set(result)
  //       }
  //     }
  // }

  // DB.prototype.archiveListen = function () {
  //   this.archiveListener = this.fireArchive
  //     .orderBy('updated', 'desc')
  //     .where('updated', '>=', this.archiveRange.from)
  //     .where('updated', '<=', this.archiveRange.to)
  //     .onSnapshot(
  //       {
  //         includeMetadataChanges: true
  //       },
  //       query => {
  //         this.updateIDB(query, true)
  //       }
  //     )
  // }

  // DB.prototype.archiveClear = function () {
  //   const name = this.name + 'Archive'
  //   return new Promise((resolve, reject) => {
  //     const clear = this.idb
  //       .transaction(name, 'readwrite')
  //       .objectStore(name)
  //       .clear()
  //     clear.onsuccess = () => resolve(null)
  //     clear.onerror = () => reject(Error(null))
  //   })
  // }

  // DB.prototype.updateIDB = function (query, archive) {
  //   if (!query.docChanges().length || query.metadata.hasPendingWrites) return
  //   const name = this.name + (archive ? 'Archive' : '')
  //   const trans = this.idb.transaction(name, 'readwrite')
  //   const store = trans.objectStore(name)
  //   const changes = []
  //   trans.onabort = e =>
  //     e.target.error.name === 'QuotaExceededError'
  //       ? this.alert('Not enough space for work')
  //       : this.alert('Something went wrong')
  //   trans.oncomplete = () => {
  //     this.synced.update(value => {
  //       value[archive ? 'archive' : 'current'] = Math.max(...changes)
  //       return { ...value }
  //     })
  //     this.release()
  //   }
  //   query.docChanges().forEach(change => {
  //     const { type, doc } = change
  //     changes.push(doc.get('updated') ? doc.get('updated').toMillis() : 0)
  //     if (type === 'removed') {
  //       store.delete(doc.id)
  //     } else {
  //       store.put(doc.data(), doc.id)
  //     }
  //   })
}

export default (config, alert) => new API(config, alert)
