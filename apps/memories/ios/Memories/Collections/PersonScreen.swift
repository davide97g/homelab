import SwiftUI

/// One face cluster's photos, plus naming it. Immich finds faces and groups them, but a group is
/// nobody until it has a name: naming is what makes "foto di marci" searchable. The same person
/// often comes out as several groups; giving a group a name that's already taken merges it.
struct PersonScreen: View {
    let person: Person
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var isFavorite: Bool
    @State private var naming = false
    @State private var merging = false
    @State private var confirmHide = false

    init(person: Person) {
        self.person = person
        _name = State(initialValue: person.name)
        _isFavorite = State(initialValue: person.isFavorite)
    }

    var body: some View {
        TimelineGridScreen(title: name.isEmpty ? "Unnamed" : name, query: .person(id: person.id))
            .toolbar {
                if name.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Add Name") { naming = true }
                            .buttonStyle(.glassProminent)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(name.isEmpty ? "Add Name" : "Rename", systemImage: "character.cursor.ibeam") { naming = true }
                        Button("Same Person As…", systemImage: "person.2.fill") { merging = true }
                        Button(isFavorite ? "Unfavorite" : "Favorite", systemImage: isFavorite ? "heart.slash" : "heart") {
                            Task { await setFavorite(!isFavorite) }
                        }
                        Divider()
                        Button("Hide This Person", systemImage: "eye.slash", role: .destructive) { confirmHide = true }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                }
            }
            .sheet(isPresented: $naming) {
                NamePersonSheet(person: Person(id: person.id, name: name, isFavorite: isFavorite)) { result in
                    switch result {
                    case .renamed(let new): name = new
                    case .merged: dismiss()
                    }
                }
                .environment(app)
            }
            .sheet(isPresented: $merging) {
                MergePersonSheet(person: Person(id: person.id, name: name, isFavorite: isFavorite)) { dismiss() }
                    .environment(app)
            }
            .confirmationDialog("Hide \(name.isEmpty ? "this person" : name)?", isPresented: $confirmHide, titleVisibility: .visible) {
                Button("Hide", role: .destructive) { Task { await hide() } }
            } message: {
                Text("They disappear from People and Search. Photos are not deleted, and you can show them again from Immich on the web.")
            }
    }

    private func setFavorite(_ value: Bool) async {
        do {
            try await app.service.updatePerson(person.id, name: nil, isHidden: nil, isFavorite: value)
            isFavorite = value
            app.peopleVersion += 1
        } catch {
            app.toast = error.localizedDescription
        }
    }

    private func hide() async {
        do {
            try await app.service.updatePerson(person.id, name: nil, isHidden: true, isFavorite: nil)
            app.peopleVersion += 1
            app.toast = "Hidden"
            dismiss()
        } catch {
            app.toast = error.localizedDescription
        }
    }
}

/// Type a name. Matching names already in use are offered: picking one (or typing it exactly)
/// merges this group into that person instead of making a second "Marci".
struct NamePersonSheet: View {
    enum Result { case renamed(String), merged }

    let person: Person
    var onDone: (Result) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var others: [Person] = []
    @State private var busy = false
    @State private var error: String?
    @State private var mergeTarget: Person?
    @FocusState private var focused: Bool

    init(person: Person, onDone: @escaping (Result) -> Void) {
        self.person = person
        self.onDone = onDone
        _text = State(initialValue: person.name)
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var matches: [Person] {
        let t = trimmed.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        guard !t.isEmpty else { return [] }
        return others.filter {
            $0.name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).hasPrefix(t)
        }
        .prefix(6).map { $0 }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Spacer()
                        AssetImage(personID: person.id)
                            .frame(width: 110, height: 110)
                            .clipShape(.circle)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                }
                Section {
                    TextField("Name", text: $text)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { Task { await save() } }
                } footer: {
                    Text("Search finds people by this name: \"foto di \(trimmed.isEmpty ? "Marci" : trimmed) al mare\".")
                }
                if !matches.isEmpty {
                    Section("Already in People: same person?") {
                        ForEach(matches) { p in
                            Button { mergeTarget = p } label: {
                                HStack(spacing: 12) {
                                    AssetImage(personID: p.id)
                                        .frame(width: 40, height: 40)
                                        .clipShape(.circle)
                                    Text(p.name).foregroundStyle(.primary)
                                    Spacer()
                                    Text("Merge").font(.subheadline).foregroundStyle(Theme.accent)
                                }
                            }
                        }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle(person.name.isEmpty ? "Add Name" : "Rename")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView()
                    } else {
                        Button("Done") { Task { await save() } }
                            .disabled(trimmed.isEmpty || trimmed == person.name)
                    }
                }
            }
            .confirmationDialog(mergeTarget.map { "Merge with \($0.name)?" } ?? "", isPresented: Binding(
                get: { mergeTarget != nil }, set: { if !$0 { mergeTarget = nil } }), titleVisibility: .visible) {
                if let target = mergeTarget {
                    Button("Merge") { Task { await merge(into: target) } }
                }
            } message: {
                Text("These photos join \(mergeTarget?.name ?? "them"). Use it when Immich split one person in two.")
            }
            .task {
                others = ((try? await app.service.people()) ?? []).filter { $0.id != person.id && !$0.name.isEmpty }
                focused = true
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        guard !trimmed.isEmpty, trimmed != person.name, !busy else { return }
        // Exactly a name in use: that's the merge question, not a second person with it.
        if let same = others.first(where: { $0.name.compare(trimmed, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) {
            mergeTarget = same
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await app.service.updatePerson(person.id, name: trimmed, isHidden: nil, isFavorite: nil)
            app.peopleVersion += 1
            onDone(.renamed(trimmed))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func merge(into target: Person) async {
        busy = true
        defer { busy = false }
        do {
            try await app.service.mergePeople(into: target.id, from: [person.id])
            app.peopleVersion += 1
            app.toast = "Merged into \(target.name)"
            onDone(.merged)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Pick who this group really is (named people first): it is merged into them.
struct MergePersonSheet: View {
    let person: Person
    var onMerged: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var people: [Person] = []
    @State private var target: Person?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote).padding()
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 16) {
                    ForEach(people) { p in
                        Button { target = p } label: {
                            VStack(spacing: 6) {
                                AssetImage(personID: p.id)
                                    .aspectRatio(1, contentMode: .fit)
                                    .clipShape(.circle)
                                Text(p.name.isEmpty ? "Unnamed" : p.name)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(p.name.isEmpty ? .secondary : .primary)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Same Person As…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .confirmationDialog("Merge?", isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }),
                                titleVisibility: .hidden) {
                if let target {
                    Button("Merge into \(target.name.isEmpty ? "this person" : target.name)") { Task { await merge(into: target) } }
                }
            }
            .task {
                let all = ((try? await app.service.people()) ?? []).filter { $0.id != person.id }
                people = all.filter { !$0.name.isEmpty } + all.filter { $0.name.isEmpty }
            }
        }
    }

    private func merge(into target: Person) async {
        do {
            // Into the named one, so the name survives either way round.
            if target.name.isEmpty, !person.name.isEmpty {
                try await app.service.mergePeople(into: person.id, from: [target.id])
                app.peopleVersion += 1
                app.toast = "Merged"
                dismiss()
                return
            }
            try await app.service.mergePeople(into: target.id, from: [person.id])
            app.peopleVersion += 1
            app.toast = "Merged into \(target.name.isEmpty ? "that person" : target.name)"
            dismiss()
            onMerged()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Long-press on a face anywhere: name it without opening it.
struct PersonContextMenu: ViewModifier {
    let person: Person
    @Binding var naming: Person?

    func body(content: Content) -> some View {
        content.contextMenu {
            Button(person.name.isEmpty ? "Add Name" : "Rename", systemImage: "character.cursor.ibeam") { naming = person }
        }
    }
}

extension View {
    func personContextMenu(_ person: Person, naming: Binding<Person?>) -> some View {
        modifier(PersonContextMenu(person: person, naming: naming))
    }
}
