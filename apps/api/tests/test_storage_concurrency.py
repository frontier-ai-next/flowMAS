from concurrent.futures import ThreadPoolExecutor

from backend.services.storage_service import StorageService
from backend.session import new_session_id, session_scope


def test_list_and_delete_graphs_are_race_safe(tmp_path):
    storage = StorageService(str(tmp_path / "data"))
    session_id = new_session_id()
    with session_scope(session_id):
        for index in range(60):
            storage.save_graph(f"graph-{index}", {"name": f"Graph {index}"})

        def list_graphs():
            with session_scope(session_id):
                return storage.list_graphs()

        def delete_graph(index: int):
            with session_scope(session_id):
                return storage.delete_graph(f"graph-{index}")

        with ThreadPoolExecutor(max_workers=24) as executor:
            futures = [executor.submit(list_graphs) for _ in range(180)]
            futures += [executor.submit(delete_graph, index) for index in range(60)]
            results = [future.result() for future in futures]

    assert all(isinstance(result, (list, bool)) for result in results)
