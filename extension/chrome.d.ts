declare namespace chrome {
  namespace permissions {
    type Permissions = { origins?: string[] };
    function request(permissions: Permissions): Promise<boolean>;
    function contains(permissions: Permissions): Promise<boolean>;
    function getAll(): Promise<Permissions>;
    function remove(permissions: Permissions): Promise<boolean>;
  }
  namespace storage {
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
    };
  }
  namespace tabs {
    function query(query: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<{ id?: number; title?: string; url?: string }[]>;
  }
  namespace scripting {
    function executeScript<T>(options: {
      target: { tabId: number };
      func: () => T;
    }): Promise<{ result?: T }[]>;
  }
  namespace runtime {
    function openOptionsPage(): Promise<void>;
  }
}
